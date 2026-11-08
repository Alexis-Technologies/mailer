// Not ported: tests of ./rbm against a stubbed fetch: the AgentMessage of
// agentMessages.create, its messageId, the token of the service account,
// the categories of the statuses of the API, and what it would refuse.
const { test } = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync } = require('node:crypto');
const { createChannelMessage } = require('../../src/channels/index.js');
const { RbmTransport } = require('../../src/rbm/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const ACCOUNT = {
  type: 'service_account',
  project_id: 'rbm-agent-1',
  client_email: 'agent@rbm-agent-1.iam.gserviceaccount.com',
  private_key: KEY,
};
const NOW = Date.parse('2026-11-08T10:00:00Z');
const TO = '+380671234567';
const transport = (config = {}) =>
  new RbmTransport({
    serviceAccount: ACCOUNT,
    agentId: 'shop_agent',
    retries: 0,
    now: () => NOW,
    generateId: () => '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    ...config,
  });
const rcs = (fields = {}) =>
  createChannelMessage({ channel: 'rcs', to: TO, text: 'Your order shipped', ...fields });
const token = () => json({ access_token: 'ya29.rbm-token', expires_in: 3600 });
// The answers of the API, the token endpoint answered apart.
const stub = (t, answer) => {
  const sends = [];
  let tokens = 0;
  stubFetch(t, (request) => {
    if (request.url.startsWith('https://oauth2.googleapis.com/')) {
      tokens++;
      return token();
    }
    sends.push(request);
    return answer(request, sends.length - 1);
  });
  return { sends, tokens: () => tokens };
};
const created = (id = '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d') =>
  json({ name: `phones/${TO}/agentMessages/${id}`, sendTime: '2026-11-08T10:00:01Z' });
const status = (code, name) =>
  json({ error: { code, message: `${name} message`, status: name } }, code);

test('RBM: a message is an AgentMessage under a messageId of the client', async (t) => {
  const { sends } = stub(t, () => created());
  const receipt = await transport().send(rcs());
  const [request] = sends;
  assert.strictEqual(
    request.url,
    `https://rcsbusinessmessaging.googleapis.com/v1/phones/${TO}/agentMessages?messageId=8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d&agentId=shop_agent`,
  );
  assert.strictEqual(request.method, 'POST');
  assert.strictEqual(request.headers.get('authorization'), 'Bearer ya29.rbm-token');
  assert.deepStrictEqual(request.json, { contentMessage: { text: 'Your order shipped' } });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    provider: 'rbm',
    channel: 'rcs',
    state: 'accepted',
  });
  t.mock.restoreAll();
  const regional = stub(t, () => created());
  await transport({ region: 'europe', agentId: 'a b' }).send(rcs());
  assert.match(
    regional.sends[0].url,
    /^https:\/\/europe-rcsbusinessmessaging\.googleapis\.com\/v1\/.*agentId=a%20b$/,
  );
});

test('RBM: the token is asked for once, and dropped when the API refuses it', async (t) => {
  const { sends, tokens } = stub(t, (_request, index) =>
    index === 1 ? status(401, 'UNAUTHENTICATED') : created(),
  );
  const rbm = transport();
  await Promise.all([rbm.send(rcs()), rbm.send(rcs())]);
  assert.strictEqual(tokens(), 1);
  await rbm.send(rcs());
  assert.strictEqual(tokens(), 2, 'a new token after the 401');
  assert.strictEqual(sends.length, 3);
});

test('RBM: a medium, buttons, the expiry and the payload of a message', async (t) => {
  const { sends } = stub(t, () => created());
  await transport().send(
    rcs({
      media: [{ url: 'https://example.com/parcel.png' }],
      buttons: [
        { type: 'url', text: 'Track', url: 'https://example.com/track/1' },
        { type: 'reply', text: 'Thanks', id: 'thanks' },
        { type: 'call', text: 'Call us', phone: '+380441234567' },
      ],
      expiresAt: new Date(NOW + 3_600_000),
      payload: { messageTrafficType: 'TRANSACTION' },
    }),
  );
  assert.deepStrictEqual(sends[0].json, {
    contentMessage: {
      richCard: {
        standaloneCard: {
          cardOrientation: 'VERTICAL',
          cardContent: {
            description: 'Your order shipped',
            media: { height: 'MEDIUM', contentInfo: { fileUrl: 'https://example.com/parcel.png' } },
            suggestions: [
              {
                action: {
                  text: 'Track',
                  postbackData: 'https://example.com/track/1',
                  openUrlAction: { url: 'https://example.com/track/1' },
                },
              },
              { reply: { text: 'Thanks', postbackData: 'thanks' } },
              {
                action: {
                  text: 'Call us',
                  postbackData: '+380441234567',
                  dialAction: { phoneNumber: '+380441234567' },
                },
              },
            ],
          },
        },
      },
    },
    expireTime: '2026-11-08T11:00:00.000Z',
    messageTrafficType: 'TRANSACTION',
  });
  await transport().send(
    rcs({ text: undefined, media: [{ url: 'https://example.com/a.pdf' }], idempotencyKey: 'o-1' }),
  );
  assert.deepStrictEqual(sends[1].json, {
    contentMessage: { contentInfo: { fileUrl: 'https://example.com/a.pdf' } },
  });
  const id = new URL(sends[1].url).searchParams.get('messageId');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]/, 'a UUID of the key');
  await transport().send(
    rcs({ idempotencyKey: 'o-1', buttons: [{ type: 'reply', text: 'Ok', id: 'ok' }] }),
  );
  assert.strictEqual(new URL(sends[2].url).searchParams.get('messageId'), id);
  assert.deepStrictEqual(sends[2].json.contentMessage.suggestions, [
    { reply: { text: 'Ok', postbackData: 'ok' } },
  ]);
});

test('RBM: a refusal is told by its status; a user without RCS is not on the channel', async (t) => {
  const cases = [
    [status(404, 'NOT_FOUND'), 'not-on-channel', false],
    [status(403, 'PERMISSION_DENIED'), 'configuration', false],
    [status(401, 'UNAUTHENTICATED'), 'auth', false],
    [status(400, 'INVALID_ARGUMENT'), 'validation', false],
    [status(429, 'RESOURCE_EXHAUSTED'), 'rate-limit', true],
    [status(503, 'UNAVAILABLE'), 'service-unavailable', true],
    [json({}, 404), 'not-on-channel', false],
  ];
  for (const [response, category, retryable] of cases) {
    t.mock.restoreAll();
    stub(t, () => response.clone());
    const receipt = await transport().send(rcs());
    assert.strictEqual(receipt.errors[0].category, category, category);
    assert.strictEqual(receipt.retryable, retryable, category);
    assert.strictEqual(receipt.channel, 'rcs');
  }
  t.mock.restoreAll();
  stub(t, () => status(404, 'NOT_FOUND'));
  const receipt = await transport().send(rcs());
  assert.strictEqual(receipt.errors[0].code, 'rbm.NOT_FOUND');
  assert.match(receipt.errorMessages[0], /RBM: NOT_FOUND message/);
});

test('RBM: a lost answer is sent again under the same id, which the API takes once', async (t) => {
  const { sends } = stub(t, (_request, index) => {
    if (index === 0) {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
      });
    }
    return status(409, 'ALREADY_EXISTS');
  });
  const receipt = await transport({ retries: 1 }).send(rcs());
  assert.strictEqual(sends.length, 2);
  assert.strictEqual(sends[0].url, sends[1].url);
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.deliveryUnknown, true, 'the first went');
  assert.strictEqual(receipt.errors[0].code, 'rbm.ALREADY_EXISTS');
});

test('RBM: what a message of RCS cannot be fails before any request', async (t) => {
  const { sends } = stub(t, () => created());
  const buttons = (count) => {
    const list = [];
    for (let i = 0; i < count; i++) list.push({ type: 'reply', text: `B${i}`, id: `b${i}` });
    return list;
  };
  const cases = [
    [rcs({ text: 'x'.repeat(3073) }), 'validation', /more than 3072/],
    [
      rcs({ text: 'x'.repeat(2001), media: [{ url: 'https://example.com/a.png' }] }),
      'validation',
      /card is more than 2000/,
    ],
    [rcs({ buttons: buttons(12) }), 'validation', /11 buttons/],
    [
      rcs({ buttons: buttons(5), media: [{ url: 'https://example.com/a.png' }] }),
      'validation',
      /card has 4/,
    ],
    [
      rcs({ buttons: [{ type: 'reply', text: 'x'.repeat(26), id: 'x' }] }),
      'validation',
      /25 characters/,
    ],
    [
      rcs({ media: [{ url: 'https://example.com/a.png' }, { url: 'https://example.com/b.png' }] }),
      'unsupported',
      /one medium/,
    ],
    [
      rcs({
        media: [{ content: new Uint8Array([1]), contentType: 'image/png', filename: 'a.png' }],
      }),
      'unsupported',
      /by its URL/,
    ],
    [rcs({ text: undefined, payload: { expireTime: 'x' } }), 'validation', /needs a text/],
    [
      createChannelMessage({ channel: 'sms', to: TO, text: 'x' }),
      'unsupported',
      /not messages of sms/,
    ],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport().send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.strictEqual(sends.length, 0);
  await transport().send(
    rcs({
      text: undefined,
      payload: { contentMessage: { uploadedRbmFile: { fileName: 'files/1' } } },
    }),
  );
  assert.strictEqual(sends.length, 1, 'a file uploaded to RBM, by the payload');
});

test('RBM: the options are checked when made, the key never shown', () => {
  assert.throws(() => new RbmTransport({ agentId: 'a' }), /needs serviceAccount/);
  assert.throws(() => transport({ agentId: '' }), /needs agentId/);
  assert.throws(() => transport({ region: 'us' }), /region must be global, europe or asia/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), TypeError);
  assert.ok(!JSON.stringify(transport()).includes('PRIVATE KEY'));
});
