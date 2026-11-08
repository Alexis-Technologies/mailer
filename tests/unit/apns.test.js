// Not ported: tests of ./apns against a stubbed fetch and a local h2c
// server: the cases of thinwrap's spec of its APNs connector (the request of
// /3/device, the ES256 token, the push type told by the payload, the
// categories of the reasons) rewritten for this transport, and those of its
// bugs (T3, T4, AP1).
const { test } = require('node:test');
const assert = require('node:assert');
const http2 = require('node:http2');
const { once } = require('node:events');
const { createPublicKey, generateKeyPairSync, verify } = require('node:crypto');
const { createChannelMessage } = require('../../src/channels/index.js');
const { ApnsTransport } = require('../../src/apns/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const NOW = Date.parse('2026-11-08T10:00:00Z');
const KEY = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const DEVICE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const APNS_ID = '8a4c5b2e-1f3d-4c6e-9a7b-0d1e2f3a4b5c';

let clock = NOW;
const transport = (config = {}) =>
  new ApnsTransport({
    teamId: 'TEAM123456',
    keyId: 'KEY1234567',
    privateKey: KEY,
    topic: 'com.example.app',
    environment: 'production',
    retries: 0,
    now: () => clock,
    generateId: () => '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    fetch: (url, init) => globalThis.fetch(url, init),
    ...config,
  });
const push = (fields = {}) =>
  createChannelMessage({
    channel: 'push',
    to: { token: DEVICE },
    title: 'Shipped',
    text: 'Order A-1 is on its way',
    ...fields,
  });
const accepted = () => new Response(null, { status: 200, headers: { 'apns-id': APNS_ID } });
const refused = (status, reason) => json({ reason }, status);
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());

test('APNs: a push is a request of /3/device with the ES256 token of the team', async (t) => {
  clock = NOW;
  const requests = stubFetch(t, () => accepted());
  const receipt = await transport().send(push({ data: { orderId: 'A-1' } }));
  const [request] = requests;
  assert.strictEqual(request.url, `https://api.push.apple.com/3/device/${DEVICE}`);
  assert.strictEqual(request.method, 'POST');
  assert.strictEqual(request.redirect, 'manual');
  assert.strictEqual(request.headers.get('apns-topic'), 'com.example.app');
  assert.strictEqual(request.headers.get('apns-push-type'), 'alert');
  assert.strictEqual(request.headers.get('apns-id'), '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d');
  assert.strictEqual(request.headers.get('apns-priority'), null, 'the default of APNs, 10');
  assert.strictEqual(request.headers.get('content-type'), 'application/json');
  assert.deepStrictEqual(request.json, {
    aps: { alert: { title: 'Shipped', body: 'Order A-1 is on its way' } },
    orderId: 'A-1',
  });
  const [header, claims, signature] = request.headers
    .get('authorization')
    .slice('bearer '.length)
    .split('.');
  assert.deepStrictEqual(decode(header), { alg: 'ES256', kid: 'KEY1234567' });
  assert.deepStrictEqual(decode(claims), { iss: 'TEAM123456', iat: NOW / 1000 });
  assert.ok(
    verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key: createPublicKey(KEY), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    ),
  );
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: APNS_ID,
    provider: 'apns',
    channel: 'push',
    state: 'sent',
  });
  t.mock.restoreAll();
  const sandbox = stubFetch(t, () => new Response(null, { status: 200 }));
  const sent = await transport({ environment: 'sandbox' }).send(push());
  assert.strictEqual(sandbox[0].url, `https://api.sandbox.push.apple.com/3/device/${DEVICE}`);
  assert.strictEqual(
    sent.messageId,
    '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    'the apns-id sent, which APNs keeps',
  );
});

test('APNs, RBM, Google Chat and TurboSMS make a UUID of an id of any shape', async (t) => {
  // Before (C18): they called the generateId of the transport with no kind
  // and sent what it gave as an apns-id, a messageId of RBM or a sequence_id
  // of TurboSMS, which must be UUIDs (or 40 characters), so a ULID failed
  // every send without an idempotency key; and none checked it.
  const { RbmTransport } = require('../../src/rbm/index.js');
  const { GoogleChatTransport } = require('../../src/google-chat/index.js');
  const { TurboSmsTransport } = require('../../src/turbosms/index.js');
  const kinds = [];
  const ulid = (kind) => {
    kinds.push(kind);
    return '01ARZ3NDEKTSV4RRFFQ69G5FAV01ARZ3NDEKTSV4RRFFQ69G5FAV';
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  clock = NOW;
  const requests = stubFetch(t, (request) => {
    if (request.url.startsWith('https://oauth2.googleapis.com/')) {
      return json({ access_token: 'ya29.x', expires_in: 3600 });
    }
    if (request.url.includes('turbosms')) {
      return json({
        response_code: 800,
        response_status: 'OK',
        response_result: [{ phone: '380671234567', response_code: 0, message_id: 'm' }],
      });
    }
    return request.url.includes('push.apple') ? accepted() : json({ name: 'spaces/A/messages/1' });
  });
  await transport({ generateId: ulid }).send(push());
  const account = {
    type: 'service_account',
    client_email: 'a@b.iam.gserviceaccount.com',
    private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }),
  };
  await new RbmTransport({
    serviceAccount: account,
    agentId: 'a',
    generateId: ulid,
    retries: 0,
  }).send(createChannelMessage({ channel: 'rcs', to: '+380671234567', text: 'x' }));
  await new GoogleChatTransport({ serviceAccount: account, generateId: ulid, retries: 0 }).send(
    createChannelMessage({ channel: 'google-chat', to: 'spaces/A', text: 'x' }),
  );
  await new TurboSmsTransport({ token: 't', sender: 'S', generateId: ulid, retries: 0 }).send(
    createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'x' }),
  );
  const sends = requests.filter((request) => !request.url.startsWith('https://oauth2'));
  assert.match(sends[0].headers.get('apns-id'), UUID);
  assert.match(new URL(sends[1].url).searchParams.get('messageId'), UUID);
  assert.match(new URL(sends[2].url).searchParams.get('requestId'), UUID);
  assert.match(sends[3].json.sequence_id, UUID);
  assert.deepStrictEqual(kinds, [
    'idempotency-key',
    'idempotency-key',
    'idempotency-key',
    'idempotency-key',
  ]);
});

test('APNs: the token is shared, and made anew only before its hour is out', async (t) => {
  // Before (T3): thinwrap signed a token for every send without a cache of
  // the application's, which APNs answers TooManyProviderTokenUpdates.
  clock = NOW;
  const requests = stubFetch(t, () => accepted());
  const apns = transport();
  await Promise.all([apns.send(push()), apns.send(push()), apns.send(push())]);
  clock = NOW + 49 * 60_000;
  await apns.send(push());
  clock = NOW + 51 * 60_000;
  await apns.send(push());
  const tokens = new Set();
  for (const request of requests) tokens.add(request.headers.get('authorization'));
  assert.strictEqual(tokens.size, 2);
  assert.strictEqual(
    requests[3].headers.get('authorization'),
    requests[0].headers.get('authorization'),
  );
  assert.notStrictEqual(
    requests[4].headers.get('authorization'),
    requests[0].headers.get('authorization'),
  );
});

test('APNs: an expired token is dropped and the push sent once more with a new one', async (t) => {
  // Before (T4): thinwrap left a token APNs refused to the application to
  // evict, so every send failed until it did.
  clock = NOW;
  const requests = stubFetch(t, (_request, index) =>
    index === 1 ? refused(403, 'ExpiredProviderToken') : accepted(),
  );
  const apns = transport({ retries: 1 });
  await apns.send(push());
  clock = NOW + 30 * 60_000;
  const receipt = await apns.send(push());
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(requests.length, 3);
  assert.strictEqual(
    requests[1].headers.get('authorization'),
    requests[0].headers.get('authorization'),
  );
  assert.notStrictEqual(
    requests[2].headers.get('authorization'),
    requests[1].headers.get('authorization'),
  );
  // A token younger than twenty minutes is kept: APNs would refuse a new one.
  t.mock.restoreAll();
  clock = NOW;
  const young = stubFetch(t, () => refused(403, 'ExpiredProviderToken'));
  const fresh = transport({ retries: 1 });
  const failed = await fresh.send(push());
  assert.strictEqual(failed.errors[0].category, 'auth');
  assert.strictEqual(young[1].headers.get('authorization'), young[0].headers.get('authorization'));
});

test('APNs: a push of data alone is a background one, with priority 5', async (t) => {
  clock = NOW;
  const requests = stubFetch(t, () => accepted());
  await transport().send(
    push({ title: undefined, text: undefined, data: { sync: '1' }, priority: 'high' }),
  );
  assert.strictEqual(requests[0].headers.get('apns-push-type'), 'background');
  assert.strictEqual(requests[0].headers.get('apns-priority'), '5');
  assert.deepStrictEqual(requests[0].json, { aps: { 'content-available': 1 }, sync: '1' });
  // A badge or a sound alone is an alert push.
  await transport().send(
    push({ title: undefined, text: undefined, payload: { payload: { aps: { badge: 3 } } } }),
  );
  assert.strictEqual(requests[1].headers.get('apns-push-type'), 'alert');
  assert.deepStrictEqual(requests[1].json, { aps: { badge: 3 } });
});

test('APNs: the priority, the expiry, the key and the payload of a push', async (t) => {
  clock = NOW;
  const requests = stubFetch(t, () => accepted());
  await transport().send(
    push({
      priority: 'low',
      expiresAt: new Date(NOW + 3_600_000),
      idempotencyKey: 'order-42',
      payload: {
        headers: { 'apns-collapse-id': 'order-42', 'APNS-Topic': 'com.example.app.other' },
        payload: { aps: { sound: 'default', alert: { subtitle: 'Today' } }, deep: { link: 'x' } },
      },
    }),
  );
  const [request] = requests;
  assert.strictEqual(request.headers.get('apns-priority'), '5');
  assert.strictEqual(request.headers.get('apns-expiration'), String((NOW + 3_600_000) / 1000));
  assert.match(request.headers.get('apns-id'), /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  assert.strictEqual(request.headers.get('apns-collapse-id'), 'order-42');
  assert.strictEqual(request.headers.get('apns-topic'), 'com.example.app.other');
  assert.deepStrictEqual(request.json, {
    aps: {
      alert: { title: 'Shipped', body: 'Order A-1 is on its way', subtitle: 'Today' },
      sound: 'default',
    },
    deep: { link: 'x' },
  });
  await transport().send(push({ idempotencyKey: 'order-42', priority: 'high' }));
  assert.strictEqual(requests[1].headers.get('apns-id'), request.headers.get('apns-id'));
  assert.strictEqual(requests[1].headers.get('apns-priority'), '10');
});

test('APNs: a refusal is told by its reason, then its status', async (t) => {
  clock = NOW;
  const cases = [
    [refused(410, 'Unregistered'), 'unregistered', false],
    [refused(410, 'ExpiredToken'), 'unregistered', false],
    [refused(400, 'BadDeviceToken'), 'invalid-recipient', false],
    [refused(400, 'DeviceTokenNotForTopic'), 'invalid-recipient', false],
    [refused(400, 'BadTopic'), 'configuration', false],
    [refused(400, 'PayloadEmpty'), 'validation', false],
    [refused(403, 'InvalidProviderToken'), 'auth', false],
    [refused(403, 'BadCertificateEnvironment'), 'configuration', false],
    [refused(413, 'PayloadTooLarge'), 'validation', false],
    [refused(429, 'TooManyProviderTokenUpdates'), 'configuration', false],
    [refused(429, 'TooManyRequests'), 'rate-limit', true],
    [refused(404, 'BadPath'), 'configuration', false],
    [json({}, 410), 'unregistered', false],
  ];
  for (const [response, category, retryable] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => response.clone());
    const receipt = await transport().send(push());
    const reason = (await response.clone().json()).reason ?? 'http_410';
    assert.strictEqual(receipt.errors[0].category, category, reason);
    assert.strictEqual(receipt.retryable, retryable, reason);
    assert.strictEqual(receipt.errors[0].code, `apns.${reason}`, reason);
    assert.strictEqual(receipt.channel, 'push');
  }
});

test('APNs: a 5xx or a lost answer is of unknown delivery, never retried', async (t) => {
  // Before (AP1): node-apn retried a 500 and a 503, after which APNs may
  // have taken the push.
  clock = NOW;
  for (const response of [
    refused(500, 'InternalServerError'),
    refused(503, 'ServiceUnavailable'),
  ]) {
    t.mock.restoreAll();
    const requests = stubFetch(t, () => response.clone());
    const receipt = await transport({ retries: 3 }).send(push());
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(receipt.deliveryUnknown, true);
  }
  t.mock.restoreAll();
  const lost = stubFetch(t, () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    });
  });
  assert.strictEqual((await transport({ retries: 3 }).send(push())).deliveryUnknown, true);
  assert.strictEqual(lost.length, 1);
});

test('APNs: what a push of APNs cannot be fails before any request', async (t) => {
  clock = NOW;
  const requests = stubFetch(t, () => accepted());
  const cases = [
    [push({ to: { topic: 'news' } }), 'unsupported', /token of a device/],
    [push({ to: { token: 'not-hex!' } }), 'invalid-recipient', /hexadecimal/],
    [push({ media: [{ url: 'https://example.com/a.png' }] }), 'unsupported', /no media/],
    [
      push({ buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }] }),
      'unsupported',
      /no buttons/,
    ],
    [push({ payload: { aps: {} } }), 'validation', /headers and payload, not aps/],
    [push({ payload: { headers: { authorization: 'x' } } }), 'validation', /header authorization/],
    [push({ payload: { headers: { 'apns-priority': 10 } } }), 'validation', /is a string/],
    [push({ data: { aps: 'x' } }), 'validation', /aps of data/],
    [push({ data: { blob: 'x'.repeat(4096) } }), 'validation', /4096 bytes/],
    [
      push({ title: undefined, text: undefined, payload: { payload: {} } }),
      'validation',
      /needs a title/,
    ],
    [
      createChannelMessage({ channel: 'sms', to: '+15559876543', text: 'x' }),
      'unsupported',
      /not messages of sms/,
    ],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport().send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.strictEqual(requests.length, 0);
  // A VoIP push may be 5 KB.
  await transport().send(
    push({ data: { blob: 'x'.repeat(4500) }, payload: { headers: { 'apns-push-type': 'voip' } } }),
  );
  assert.strictEqual(requests.length, 1);
});

test('APNs: the options are checked when made, the environment never from NODE_ENV', (t) => {
  // Before (AP1): node-apn chose production by NODE_ENV.
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  });
  assert.throws(() => transport({ environment: undefined }), /environment must be production/);
  assert.throws(() => transport({ teamId: 'team' }), /teamId must be the ten characters/);
  assert.throws(() => transport({ keyId: undefined }), /keyId must be/);
  assert.throws(() => transport({ topic: '' }), /needs topic/);
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.throws(() => transport({ privateKey: rsa }), /P-256/);
  assert.throws(() => transport({ privateKey: 'not a key' }), /no private key/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), TypeError);
  const body = KEY.split('\n')[1];
  assert.ok(!JSON.stringify(transport()).includes(body));
});

test('APNs: a push goes over HTTP/2 to a local server, the session closed on dispose', async (t) => {
  clock = NOW;
  const server = http2.createServer();
  const seen = [];
  const sessions = [];
  server.on('session', (session) => sessions.push(session));
  server.on('stream', (stream, headers) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => (body += chunk));
    stream.on('end', () => {
      seen.push({ headers, body });
      stream.respond({ ':status': 200, 'apns-id': headers['apns-id'] });
      stream.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    for (const session of sessions) session.destroy();
    server.close();
  });
  const apns = transport({
    fetch: undefined,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  });
  const receipts = [];
  for await (const receipt of apns.sendMany([push(), push({ text: 'second' })])) {
    receipts.push(receipt);
  }
  assert.strictEqual(receipts.length, 2);
  assert.strictEqual(receipts[0].successful, true);
  assert.strictEqual(receipts[0].messageId, '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d');
  assert.strictEqual(seen[0].headers[':path'], `/3/device/${DEVICE}`);
  assert.strictEqual(seen[0].headers['apns-topic'], 'com.example.app');
  assert.match(seen[0].headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.strictEqual(JSON.parse(seen[1].body).aps.alert.body, 'second');
  assert.strictEqual(sessions.length, 1, 'one session of the origin');
  await apns[Symbol.asyncDispose]();
  assert.strictEqual(sessions[0].closed || sessions[0].destroyed, true);
});
