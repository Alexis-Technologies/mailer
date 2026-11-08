// Not ported: tests of ./webpush against a stubbed fetch: the vector of
// RFC 8291 §5 for the encryption ported from http_ece, VAPID of RFC 8292, the
// request of RFC 8030, the check of the endpoint and the bugs of the sources.
const { test } = require('node:test');
const assert = require('node:assert');
const { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } = require('node:crypto');
const { createChannelMessage } = require('../../src/channels/index.js');
const { WebPushTransport } = require('../../src/webpush/index.js');
const { encryptPush } = require('../../src/webpush/encryption.js');
const { stubFetch } = require('../helpers/providers/fetch.js');

const b64 = (text) => Buffer.from(text, 'base64url');
const NOW = Date.parse('2026-11-08T10:00:00Z');
const app = createECDH('prime256v1');
app.generateKeys();
const browser = createECDH('prime256v1');
browser.generateKeys();
const AUTH = Buffer.alloc(16, 9);
const VAPID = {
  subject: 'mailto:ops@example.com',
  publicKey: app.getPublicKey().toString('base64url'),
  privateKey: app.getPrivateKey().toString('base64url'),
};
const SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def',
  keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: AUTH.toString('base64url') },
};
const publicLookup = async () => [{ address: '142.250.0.1', family: 4 }];
const transport = (config = {}) =>
  new WebPushTransport({
    vapid: VAPID,
    retries: 0,
    lookup: publicLookup,
    now: () => NOW,
    ...config,
  });
const push = (fields = {}) =>
  createChannelMessage({
    channel: 'push',
    to: SUBSCRIPTION,
    title: 'Shipped',
    text: 'Order A-1',
    ...fields,
  });
const created = (location) =>
  new Response(null, {
    status: 201,
    headers: location === undefined ? {} : { Location: location },
  });

// What the browser reads of a body: the decryption of RFC 8291 with its key.
const decrypt = (body) => {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const sender = body.subarray(21, 21 + idLength);
  const record = body.subarray(21 + idLength);
  const secret = browser.computeSecret(sender);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), sender]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, AUTH, info, 32));
  const key = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  assert.strictEqual(plain.at(-1), 2, 'the last record ends with 0x02');
  return JSON.parse(plain.subarray(0, -1).toString());
};

test('Web Push: the encryption is that of the vector of RFC 8291 §5', () => {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
  const body = encryptPush(
    Buffer.from('When I grow up, I want to be a watermelon'),
    {
      p256dh: b64(
        'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      ),
      auth: b64('BTBZMqHH6r4Tts7J_aSIgg'),
    },
    { ecdh, salt: b64('DGv6ra1nlYgDCS1FRnbzlw') },
  );
  assert.strictEqual(
    body.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
});

test('Web Push: a push is the notification as JSON, encrypted, with VAPID, TTL and Urgency', async (t) => {
  const requests = stubFetch(t, () => created('https://fcm.googleapis.com/m/1'));
  const receipt = await transport().send(
    push({
      media: [{ url: 'https://example.com/a.png', contentType: 'image/png' }],
      data: { order: 'A-1' },
      buttons: [
        { type: 'url', text: 'Open', url: 'https://example.com/o/1' },
        { type: 'reply', text: 'Archive', id: 'archive' },
      ],
      priority: 'high',
      payload: { tag: 'orders', topic: 'order-A1', requireInteraction: true },
    }),
  );
  const [request] = requests;
  assert.strictEqual(request.url, SUBSCRIPTION.endpoint);
  assert.strictEqual(request.headers.get('content-encoding'), 'aes128gcm');
  assert.strictEqual(request.headers.get('content-type'), 'application/octet-stream');
  assert.strictEqual(request.headers.get('ttl'), '2419200');
  assert.strictEqual(request.headers.get('urgency'), 'high');
  assert.strictEqual(request.headers.get('topic'), 'order-A1');
  assert.deepStrictEqual(decrypt(request.body), {
    title: 'Shipped',
    body: 'Order A-1',
    image: 'https://example.com/a.png',
    data: { order: 'A-1' },
    actions: [
      { action: 'https://example.com/o/1', title: 'Open', url: 'https://example.com/o/1' },
      { action: 'archive', title: 'Archive' },
    ],
    tag: 'orders',
    requireInteraction: true,
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: 'https://fcm.googleapis.com/m/1',
    provider: 'webpush',
    channel: 'push',
    state: 'sent',
  });
});

test('Web Push: the JWT of VAPID is for the origin of the endpoint, held for it', async (t) => {
  const requests = stubFetch(t, () => created());
  const webpush = transport({ generateId: () => 'local-1' });
  const receipt = await webpush.send(push());
  await webpush.send(push());
  await webpush.send(
    push({
      to: { ...SUBSCRIPTION, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x' },
    }),
  );
  const tokenOf = (request) =>
    /^vapid t=([^,]+), k=(.+)$/.exec(request.headers.get('authorization'));
  const [, first, key] = tokenOf(requests[0]);
  assert.strictEqual(key, VAPID.publicKey);
  assert.strictEqual(tokenOf(requests[1])[1], first, 'the JWT of an origin is held');
  assert.notStrictEqual(tokenOf(requests[2])[1], first);
  const [header, claims, signature] = first.split('.');
  assert.deepStrictEqual(JSON.parse(b64(claims)), {
    aud: 'https://fcm.googleapis.com',
    exp: NOW / 1000 + 12 * 60 * 60,
    sub: 'mailto:ops@example.com',
  });
  const publicKey = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: app.getPublicKey().subarray(1, 33).toString('base64url'),
      y: app.getPublicKey().subarray(33).toString('base64url'),
    },
    format: 'jwk',
  });
  assert.ok(
    verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      b64(signature),
    ),
  );
  // A service that names no message: an id of the transport's own.
  assert.strictEqual(receipt.messageId, 'webpush:local-1');
});

test('Web Push: expiresAt is the TTL, and a low priority the urgency low', async (t) => {
  const requests = stubFetch(t, () => created());
  await transport().send(push({ priority: 'low', expiresAt: new Date(NOW + 90_000) }));
  assert.strictEqual(requests[0].headers.get('ttl'), '90');
  assert.strictEqual(requests[0].headers.get('urgency'), 'low');
  await transport({ ttl: 60 }).send(push());
  assert.strictEqual(requests[1].headers.get('ttl'), '60');
});

test('Web Push: an answer of a push service is told by its status', async (t) => {
  // Before (V14): visulima classified none of them, so a subscription gone
  // was a failure like any other, never dropped.
  const cases = [
    [404, 'unregistered', 'webpush.not_found'],
    [410, 'unregistered', 'webpush.gone'],
    [413, 'validation', 'webpush.too_large'],
    [400, 'validation', 'webpush.bad_request'],
    [401, 'auth', 'webpush.unauthorized'],
    [403, 'auth', 'webpush.forbidden'],
  ];
  for (const [status, category, code] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => new Response('refused', { status }));
    const receipt = await transport().send(push());
    assert.strictEqual(receipt.errors[0].category, category, String(status));
    assert.strictEqual(receipt.errors[0].code, code, String(status));
    assert.strictEqual(receipt.retryable, false, String(status));
  }
  t.mock.restoreAll();
  const requests = stubFetch(t, (_request, index) =>
    index === 0 ? new Response('', { status: 429, headers: { 'Retry-After': '0' } }) : created(),
  );
  assert.strictEqual((await transport({ retries: 1 }).send(push())).successful, true);
  assert.strictEqual(requests.length, 2);
});

test('Web Push: an endpoint of this network, or refused, is no recipient, nothing sent', async (t) => {
  const requests = stubFetch(t, () => created());
  const cases = [
    [{ lookup: async () => [{ address: '10.0.0.5', family: 4 }] }, SUBSCRIPTION.endpoint],
    [{ lookup: async () => [{ address: '169.254.169.254', family: 4 }] }, SUBSCRIPTION.endpoint],
    [{}, 'https://127.0.0.1/push'],
    [{}, 'https://localhost/push'],
    [{ allowEndpoint: (url) => url.hostname === 'push.example.org' }, SUBSCRIPTION.endpoint],
  ];
  for (const [config, endpoint] of cases) {
    const receipt = await transport(config).send(push({ to: { ...SUBSCRIPTION, endpoint } }));
    assert.strictEqual(receipt.errors[0].category, 'invalid-recipient', endpoint);
    assert.match(receipt.errorMessages[0], /not a public HTTPS URL/);
  }
  assert.strictEqual(requests.length, 0);
  // allowEndpoint lets a push service of this network in.
  await transport({ allowEndpoint: () => true }).send(
    push({ to: { ...SUBSCRIPTION, endpoint: 'https://127.0.0.1/push' } }),
  );
  assert.strictEqual(requests.length, 1);
});

test('Web Push: what a push service would refuse fails before any request', async (t) => {
  // Before (V14): visulima had no bound on the size of a push.
  const requests = stubFetch(t, () => created());
  const cases = [
    [push({ text: 'x'.repeat(4000) }), 'validation', /more than 3993/],
    [push({ payload: { topic: 'not a topic!' } }), 'validation', /1 to 32 characters/],
    [push({ to: { token: 'fcm-token' } }), 'unsupported', /not to a token or a topic/],
    [
      push({ buttons: [{ type: 'call', text: 'x', phone: '+380671234567' }] }),
      'unsupported',
      /call a phone/,
    ],
    [
      push({ media: [{ content: new Uint8Array(1), contentType: 'image/png' }] }),
      'unsupported',
      /one picture/,
    ],
    [
      push({ to: { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, p256dh: 'AAAA' } } }),
      'invalid-recipient',
      /no public key of P-256/,
    ],
    // Before (C31): 65 bytes from 0x04 that are no point of the curve failed
    // as unknown when ECDH refused them, and the subscription was kept.
    [
      push({
        to: {
          ...SUBSCRIPTION,
          keys: {
            ...SUBSCRIPTION.keys,
            p256dh: Buffer.from([4, ...new Uint8Array(64).fill(1)]).toString('base64url'),
          },
        },
      }),
      'invalid-recipient',
      /no public key of P-256/,
    ],
    [
      push({ to: { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, auth: 'AAAA' } } }),
      'invalid-recipient',
      /not 16 bytes/,
    ],
  ];
  for (const [sent, category, pattern] of cases) {
    const receipt = await transport().send(sent);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.strictEqual(requests.length, 0);
});

test('Web Push: the VAPID keys are checked when the transport is made', () => {
  // Before (V14): a bad key of web-push threw from send().
  const other = createECDH('prime256v1');
  other.generateKeys();
  assert.throws(() => new WebPushTransport({}), /needs vapid/);
  assert.throws(
    () => transport({ vapid: { ...VAPID, subject: 'ops@example.com' } }),
    /mailto: or an https: URL/,
  );
  assert.throws(() => transport({ vapid: { ...VAPID, publicKey: 'short' } }), /65 bytes/);
  assert.throws(() => transport({ vapid: { ...VAPID, privateKey: 'short' } }), /32 bytes/);
  assert.throws(
    () => transport({ vapid: { ...VAPID, publicKey: other.getPublicKey().toString('base64url') } }),
    /not the public key of vapid.privateKey/,
  );
  assert.throws(() => transport({ ttl: -1 }), /whole number of seconds/);
  assert.ok(!JSON.stringify(transport()).includes(VAPID.privateKey));
});

test('Web Push: no key is printed, whatever ECE_KEYLOG says', async (t) => {
  // Before (EC1): http_ece printed every key and nonce with ECE_KEYLOG=1.
  stubFetch(t, () => created());
  const written = [];
  t.mock.method(console, 'log', (...args) => written.push(args));
  t.mock.method(console, 'warn', (...args) => written.push(args));
  t.mock.method(process.stdout, 'write', (chunk) => written.push(chunk));
  process.env.ECE_KEYLOG = '1';
  t.after(() => {
    delete process.env.ECE_KEYLOG;
  });
  await transport().send(push());
  assert.deepStrictEqual(written, []);
});
