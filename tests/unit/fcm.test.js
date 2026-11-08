// Not ported: tests of ./fcm against a stubbed fetch, the cases of thinwrap's
// spec of its FCM connector (the body of messages:send, its oneof of
// targets, the categories of its statuses) rewritten for this transport, and
// those of its token, its platforms, its error codes and bugs.
const { test } = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync } = require('node:crypto');
const { createChannelMessage } = require('../../src/channels/index.js');
const { FcmTransport } = require('../../src/fcm/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const ACCOUNT = {
  type: 'service_account',
  project_id: 'shop-app-1',
  client_email: 'push@shop-app-1.iam.gserviceaccount.com',
  private_key: KEY,
};
const NOW = Date.parse('2026-11-08T10:00:00Z');
const SEND_URL = 'https://fcm.googleapis.com/v1/projects/shop-app-1/messages:send';
const transport = (config = {}) =>
  new FcmTransport({ serviceAccount: ACCOUNT, retries: 0, now: () => NOW, ...config });
const push = (fields = {}) =>
  createChannelMessage({
    channel: 'push',
    to: { token: 'device-1' },
    title: 'Shipped',
    text: 'Order A-1',
    ...fields,
  });
const named = (name = 'projects/shop-app-1/messages/0:1') => json({ name });
const fcmError = (status, httpStatus, errorCode, extra = []) =>
  json(
    {
      error: {
        code: httpStatus,
        message: `${errorCode ?? status}`,
        status,
        details: [
          ...(errorCode === undefined
            ? []
            : [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }]),
          ...extra,
        ],
      },
    },
    httpStatus,
  );
// A fetch that answers the token endpoint, and the provider with `respond`.
const stub = (t, respond) => {
  const tokens = [];
  const requests = stubFetch(t, (request, index) => {
    if (request.url.startsWith('https://oauth2.googleapis.com/')) {
      tokens.push(new URLSearchParams(request.body));
      return json({ access_token: `ya29.token-${tokens.length}`, expires_in: 3600 });
    }
    return respond(request, index);
  });
  return { tokens, sends: () => requests.filter((request) => request.url === SEND_URL) };
};

test('FCM: a push is messages:send with the token of the service account', async (t) => {
  const { tokens, sends } = stub(t, () => named());
  const receipt = await transport().send(push({ data: { order: 'A-1' } }));
  assert.strictEqual(tokens.length, 1);
  assert.strictEqual(tokens[0].get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [sent] = sends();
  assert.strictEqual(sent.headers.get('authorization'), 'Bearer ya29.token-1');
  assert.deepStrictEqual(sent.json, {
    message: {
      token: 'device-1',
      notification: { title: 'Shipped', body: 'Order A-1' },
      data: { order: 'A-1' },
    },
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: 'projects/shop-app-1/messages/0:1',
    provider: 'fcm',
    channel: 'push',
    state: 'sent',
  });
});

test('FCM: the token is asked for once for many sends, and again after a 401', async (t) => {
  // Before (T3): thinwrap made a token for every send without a cache of the
  // application's.
  let count = 0;
  const { tokens, sends } = stub(t, () =>
    ++count === 4 ? fcmError('UNAUTHENTICATED', 401) : named(),
  );
  const fcm = transport();
  await Promise.all([fcm.send(push()), fcm.send(push()), fcm.send(push())]);
  assert.strictEqual(tokens.length, 1);
  const refused = await fcm.send(push());
  assert.strictEqual(refused.errors[0].category, 'auth');
  await fcm.send(push());
  assert.strictEqual(tokens.length, 2);
  assert.strictEqual(sends().at(-1).headers.get('authorization'), 'Bearer ya29.token-2');
});

test('FCM: a topic, a picture, the priority and the expiry on each platform', async (t) => {
  // Before (V16): visulima set the TTL on Android alone, so an iOS or a web
  // push outlived it.
  const { sends } = stub(t, () => named());
  await transport().send(
    push({
      to: { topic: 'news' },
      media: [{ url: 'https://example.com/a.png', contentType: 'image/png' }],
      priority: 'high',
      expiresAt: new Date(NOW + 3_600_000),
    }),
  );
  assert.deepStrictEqual(sends()[0].json.message, {
    topic: 'news',
    notification: { title: 'Shipped', body: 'Order A-1', image: 'https://example.com/a.png' },
    android: { priority: 'HIGH', ttl: '3600s' },
    apns: {
      headers: { 'apns-priority': '10', 'apns-expiration': String((NOW + 3_600_000) / 1000) },
    },
    webpush: { headers: { Urgency: 'high', TTL: '3600' } },
  });
  await transport().send(push({ priority: 'low', expiresAt: new Date(NOW - 1000) }));
  assert.deepStrictEqual(sends()[1].json.message.android, { priority: 'NORMAL', ttl: '0s' });
  assert.strictEqual(sends()[1].json.message.webpush.headers.Urgency, 'low');
});

test('FCM: the payload merges over the message, key by key, but its target', async (t) => {
  const { sends } = stub(t, () => named());
  await transport().send(
    push({
      priority: 'high',
      payload: {
        android: { notification: { channel_id: 'orders' } },
        apns: { payload: { aps: { sound: 'default' } } },
        fcm_options: { analytics_label: 'orders' },
      },
    }),
  );
  const { message } = sends()[0].json;
  assert.deepStrictEqual(message.android, {
    priority: 'HIGH',
    notification: { channel_id: 'orders' },
  });
  assert.deepStrictEqual(message.apns, {
    headers: { 'apns-priority': '10' },
    payload: { aps: { sound: 'default' } },
  });
  assert.deepStrictEqual(message.fcm_options, { analytics_label: 'orders' });
});

test('FCM: an error is told by its FcmError first, then its status', async (t) => {
  // Before (T5): thinwrap read the status alone, so an unregistered token and
  // a project not found were both an invalid recipient.
  const cases = [
    [fcmError('NOT_FOUND', 404, 'UNREGISTERED'), 'unregistered', 'fcm.UNREGISTERED', false],
    [
      fcmError('PERMISSION_DENIED', 403, 'SENDER_ID_MISMATCH'),
      'invalid-recipient',
      'fcm.SENDER_ID_MISMATCH',
      false,
    ],
    [
      fcmError('UNAUTHENTICATED', 401, 'THIRD_PARTY_AUTH_ERROR'),
      'configuration',
      'fcm.THIRD_PARTY_AUTH_ERROR',
      false,
    ],
    [
      fcmError('INVALID_ARGUMENT', 400, 'INVALID_ARGUMENT'),
      'validation',
      'fcm.INVALID_ARGUMENT',
      false,
    ],
    [
      fcmError('INVALID_ARGUMENT', 400, 'INVALID_ARGUMENT', [
        {
          '@type': 'type.googleapis.com/google.rpc.BadRequest',
          fieldViolations: [{ field: 'message.token', description: 'Invalid registration token' }],
        },
      ]),
      'unregistered',
      'fcm.INVALID_TOKEN',
      false,
    ],
    [fcmError('NOT_FOUND', 404), 'configuration', 'fcm.NOT_FOUND', false],
    [fcmError('PERMISSION_DENIED', 403), 'auth', 'fcm.PERMISSION_DENIED', false],
    [
      fcmError('RESOURCE_EXHAUSTED', 429, 'QUOTA_EXCEEDED'),
      'rate-limit',
      'fcm.QUOTA_EXCEEDED',
      true,
    ],
    [fcmError('UNAVAILABLE', 503, 'UNAVAILABLE'), 'service-unavailable', 'fcm.UNAVAILABLE', true],
    [fcmError('INTERNAL', 500, 'INTERNAL'), 'server-error', 'fcm.INTERNAL', true],
  ];
  for (const [answer, category, code, retryable] of cases) {
    t.mock.restoreAll();
    stub(t, () => answer.clone());
    const receipt = await transport().send(push());
    assert.strictEqual(receipt.errors[0].category, category, code);
    assert.strictEqual(receipt.errors[0].code, code, code);
    assert.strictEqual(receipt.retryable, retryable, code);
  }
});

test('FCM: a lost answer is not sent again; a 503 is, after its Retry-After', async (t) => {
  // Before (FB1): firebase-admin retried messages:send after ETIMEDOUT.
  const reset = () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
    });
  };
  const lost = stub(t, reset);
  const receipt = await transport({ retries: 3 }).send(push());
  assert.strictEqual(lost.sends().length, 1);
  assert.strictEqual(receipt.deliveryUnknown, true);
  t.mock.restoreAll();
  const busy = stub(t, (_request, index) =>
    index === 1
      ? json({ error: { code: 503, status: 'UNAVAILABLE', message: 'busy' } }, 503, {
          'Retry-After': '0',
        })
      : named(),
  );
  const again = await transport({ retries: 1 }).send(push());
  assert.strictEqual(again.successful, true);
  assert.strictEqual(busy.sends().length, 2);
});

test('FCM: a token refused by Google fails the send as auth, nothing sent', async (t) => {
  const requests = stubFetch(t, (request) =>
    request.url.startsWith('https://oauth2.googleapis.com/')
      ? json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400)
      : named(),
  );
  const receipt = await transport().send(push());
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.errors[0].category, 'auth');
  assert.match(receipt.errorMessages[0], /Invalid JWT Signature/);
  assert.strictEqual(requests.filter((request) => request.url === SEND_URL).length, 0);
});

test('FCM: an answer without its name is of unknown delivery', async (t) => {
  stub(t, () => json({}));
  assert.strictEqual((await transport().send(push())).deliveryUnknown, true);
});

test('FCM: what FCM would refuse fails before any request', async (t) => {
  const { sends } = stub(t, () => named());
  const subscription = {
    endpoint: 'https://push.example.com/x',
    keys: { p256dh: 'BOr0mUg', auth: 'c2VjcmV0' },
  };
  const cases = [
    [push({ data: { from: 'x' } }), 'validation', /key from of data/],
    [push({ data: { 'google.c': 'x' } }), 'validation', /starts with google\./],
    [push({ data: { 'gcm.n': 'x' } }), 'validation', /starts with gcm\./],
    [push({ to: subscription }), 'unsupported', /subscription of Web Push/],
    [
      push({ buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }] }),
      'unsupported',
      /no buttons/,
    ],
    [
      push({ media: [{ content: new Uint8Array(1), contentType: 'image/png' }] }),
      'unsupported',
      /one picture/,
    ],
    [push({ payload: { topic: 'other' } }), 'validation', /cannot set topic/],
  ];
  for (const [sent, category, pattern] of cases) {
    const receipt = await transport().send(sent);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
    assert.strictEqual(receipt.channel, 'push');
  }
  assert.strictEqual(sends().length, 0);
});

test('FCM: the account and the project are checked when made, never shown', () => {
  assert.throws(() => new FcmTransport({}), /needs serviceAccount/);
  assert.throws(
    () => new FcmTransport({ serviceAccount: { ...ACCOUNT, project_id: undefined } }),
    /needs projectId/,
  );
  assert.throws(
    () => new FcmTransport({ serviceAccount: ACCOUNT, projectId: 'Bad/Path' }),
    /needs projectId/,
  );
  assert.throws(
    () => new FcmTransport({ serviceAccount: { ...ACCOUNT, private_key: 'nope' } }),
    TypeError,
  );
  assert.throws(() => transport({ baseUrl: 'http://fcm.example.com' }), TypeError);
  assert.ok(!JSON.stringify(transport()).includes('PRIVATE KEY'));
});

test('FCM: verify is a dry run to a topic, which sends nothing', async (t) => {
  const { sends } = stub(t, () => named('projects/shop-app-1/messages/fake'));
  await transport().verify();
  assert.deepStrictEqual(sends()[0].json, {
    validate_only: true,
    message: { topic: 'mailer-verify', data: { verify: '1' } },
  });
  t.mock.restoreAll();
  stub(t, () => fcmError('PERMISSION_DENIED', 403));
  await assert.rejects(transport().verify(), (error) => error.statusCode === 403);
});
