// Not ported: tests of the Mailgun and Postmark verifiers of ./webhooks,
// ported from sently's Mailgun and Postmark webhooks.
const { test } = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('node:crypto');
const {
  createMailgunWebhookVerifier,
  createPostmarkWebhookVerifier,
  WebhookVerificationError,
} = require('../../src/webhooks/index.js');

const KEY = 'key-mailgun-signing';
const NOW = 1_800_000_000_000;
const mailgun = (options = {}) =>
  createMailgunWebhookVerifier({ signingKey: KEY, now: () => NOW, ...options });
const signedMailgun = (data, token = 'token-1', timestamp = '1800000000') => ({
  body: JSON.stringify({
    signature: {
      timestamp,
      token,
      signature: createHmac('sha256', KEY)
        .update(timestamp + token)
        .digest('hex'),
    },
    'event-data': data,
  }),
  headers: {},
});
const eventData = (fields = {}) => ({
  id: 'mg-event-1',
  event: 'delivered',
  timestamp: 1_799_999_990.5,
  recipient: 'bob@example.com',
  message: { headers: { 'message-id': '20270115.1@mg.example.com' } },
  tags: ['orders'],
  'user-variables': { orderId: '42', attempt: 2, nested: { a: 1 } },
  ...fields,
});

const rejects = async (promise, reason) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof WebhookVerificationError, String(error));
    assert.strictEqual(error.reason, reason, error.message);
    return true;
  });
};

test('Webhooks Mailgun: a signed event, its message id that of the receipt', async () => {
  const data = eventData();
  const { events } = await mailgun().verify(signedMailgun(data));
  assert.deepStrictEqual(
    { ...events[0], metadata: { ...events[0].metadata } },
    {
      provider: 'mailgun',
      type: 'delivered',
      id: 'mg-event-1',
      messageId: '<20270115.1@mg.example.com>',
      recipient: 'bob@example.com',
      occurredAt: new Date(1_799_999_990_500),
      tags: ['orders'],
      metadata: { orderId: '42', attempt: '2' },
      raw: data,
    },
  );
});

test('Webhooks Mailgun: a failure is a bounce, a deferral or a rejection', async () => {
  const verifier = mailgun();
  const cases = [
    [
      {
        event: 'failed',
        severity: 'permanent',
        reason: 'bounce',
        'delivery-status': { code: 550, description: 'No such user' },
      },
      'bounced',
      { kind: 'hard', code: '550', diagnostic: 'No such user' },
    ],
    [
      {
        event: 'failed',
        severity: 'temporary',
        reason: 'generic',
        'delivery-status': { message: 'Try later' },
      },
      'deferred',
      { kind: 'soft', diagnostic: 'Try later' },
    ],
    // Changed in the port: sently took a suppressed address for a bounce.
    [{ event: 'failed', severity: 'permanent', reason: 'suppress-bounce' }, 'rejected', undefined],
    [{ event: 'failed', severity: 'permanent' }, 'bounced', { kind: 'hard' }],
    [{ event: 'rejected', reject: { reason: 'Sandbox domain' } }, 'rejected', undefined],
    [{ event: 'accepted' }, 'accepted', undefined],
    [{ event: 'complained' }, 'complained', undefined],
    [{ event: 'unsubscribed' }, 'unsubscribed', undefined],
    [{ event: 'opened' }, 'opened', undefined],
    [{ event: 'clicked', url: 'https://e.com/a' }, 'clicked', undefined],
    [{ event: 'stored' }, 'unknown', undefined],
  ];
  for (let i = 0; i < cases.length; i++) {
    const [fields, type, bounce] = cases[i];
    const { events } = await verifier.verify(
      signedMailgun(eventData({ id: `e-${i}`, ...fields }), `t-${i}`),
    );
    assert.strictEqual(events[0].type, type, JSON.stringify(fields));
    assert.deepStrictEqual(events[0].bounce, bounce);
  }
  const reject = await verifier.verify(
    signedMailgun(eventData({ id: 'r', event: 'rejected', reject: { reason: 'Sandbox' } }), 't-r'),
  );
  assert.strictEqual(reject.events[0].reason, 'Sandbox');
  const bare = await verifier.verify(
    signedMailgun(
      { event: 'delivered', message: { headers: { 'message-id': '<x@mg>' } } },
      't-bare',
    ),
  );
  assert.strictEqual(bare.events[0].id, 't-bare');
  assert.strictEqual(bare.events[0].messageId, '<x@mg>');
  assert.deepStrictEqual(bare.events[0].tags, []);
  const none = await verifier.verify(signedMailgun({ event: 'delivered' }, 't-none'));
  assert.strictEqual(none.events[0].messageId, undefined);
});

test('Webhooks Mailgun: a forged, old or repeated request is refused', async () => {
  const verifier = mailgun();
  const good = signedMailgun(eventData());
  const forged = JSON.parse(good.body);
  forged.signature.signature = '00'.repeat(32);
  await rejects(verifier.verify({ body: JSON.stringify(forged) }), 'signature');
  forged.signature.signature = 'not hex';
  await rejects(verifier.verify({ body: JSON.stringify(forged) }), 'signature');
  await rejects(
    verifier.verify({ body: JSON.stringify({ 'event-data': eventData() }) }),
    'signature',
  );
  // Changed in the port: sently took any time and any replay.
  await rejects(verifier.verify(signedMailgun(eventData(), 'old', '1799990000')), 'timestamp');
  await verifier.verify(good);
  await rejects(verifier.verify(good), 'replay');
  await rejects(verifier.verify(signedMailgun('nothing', 'no-data')), 'payload');
  await rejects(verifier.verify({ body: '"text"' }), 'signature');
  assert.throws(() => createMailgunWebhookVerifier({}), /signingKey/);
});

const POSTMARK = { username: 'hook', password: 's3cret' };
const postmark = () => createPostmarkWebhookVerifier(POSTMARK);
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const posted = (record, authorization = basic('hook', 's3cret')) => ({
  body: JSON.stringify(record),
  headers: { Authorization: authorization },
});

test('Webhooks Postmark: credentials are required, and compared', async () => {
  // Changed in the port: sently parsed any request.
  const record = {
    RecordType: 'Delivery',
    MessageID: 'pm-1',
    Recipient: 'bob@example.com',
    DeliveredAt: '2027-01-15T08:00:00Z',
    Tag: 'welcome',
    Metadata: { orderId: '42', n: 1 },
  };
  const { events } = await postmark().verify(posted(record));
  assert.deepStrictEqual(
    { ...events[0], metadata: { ...events[0].metadata } },
    {
      provider: 'postmark',
      type: 'delivered',
      id: 'Delivery:pm-1:bob@example.com:2027-01-15T08:00:00.000Z',
      messageId: 'pm-1',
      recipient: 'bob@example.com',
      occurredAt: new Date('2027-01-15T08:00:00Z'),
      tags: ['welcome'],
      metadata: { orderId: '42' },
      raw: record,
    },
  );
  await rejects(postmark().verify(posted(record, basic('hook', 'wrong'))), 'credentials');
  await rejects(postmark().verify(posted(record, 'Bearer x')), 'credentials');
  await rejects(postmark().verify({ body: JSON.stringify(record), headers: {} }), 'credentials');
  assert.strictEqual(
    (await postmark().verify(posted(record, `basic  ${basic('hook', 's3cret').slice(6)}`))).events
      .length,
    1,
  );
  await rejects(postmark().verify(posted({ nothing: true })), 'payload');
  assert.throws(() => createPostmarkWebhookVerifier({ username: 'hook' }), /password is required/);
  assert.throws(() => createPostmarkWebhookVerifier({}), /username is required/);
});

test('Webhooks Postmark: a bounce is read by its type', async () => {
  const verifier = postmark();
  const bounce = (type, fields = {}) =>
    posted({
      RecordType: 'Bounce',
      ID: 4242,
      Type: type,
      TypeCode: 1,
      Email: 'bob@example.com',
      MessageID: 'pm-2',
      BouncedAt: '2027-01-15T08:00:00Z',
      Description: 'Bounced',
      Details: 'smtp;550 5.1.1',
      ...fields,
    });
  const cases = [
    ['HardBounce', 'bounced', 'hard'],
    ['SoftBounce', 'bounced', 'soft'],
    ['Transient', 'deferred', 'soft'],
    // Changed in the port: sently made each of these a bounce.
    ['SpamComplaint', 'complained', undefined],
    ['Unsubscribe', 'unsubscribed', undefined],
    ['ManuallyDeactivated', 'rejected', undefined],
    ['AutoResponder', 'unknown', undefined],
    ['SomethingNew', 'bounced', 'undetermined'],
  ];
  for (const [type, eventType, kind] of cases) {
    const { events } = await verifier.verify(bounce(type));
    assert.strictEqual(events[0].type, eventType, type);
    assert.strictEqual(events[0].bounce?.kind, kind, type);
    assert.strictEqual(events[0].id, 'Bounce:4242');
    assert.strictEqual(events[0].reason, type);
  }
  const hard = await verifier.verify(bounce('HardBounce'));
  assert.deepStrictEqual(hard.events[0].bounce, {
    kind: 'hard',
    code: '1',
    diagnostic: 'smtp;550 5.1.1',
  });
  const plain = await verifier.verify(
    bounce('HardBounce', { TypeCode: undefined, Details: '', Description: undefined }),
  );
  assert.deepStrictEqual(plain.events[0].bounce, { kind: 'hard' });
  const others = [
    [
      { RecordType: 'SpamComplaint', Email: 'bob@example.com', BouncedAt: '2027-01-15T08:00:00Z' },
      'complained',
    ],
    [
      { RecordType: 'Open', Recipient: 'bob@example.com', ReceivedAt: '2027-01-15T08:00:00Z' },
      'opened',
    ],
    [
      { RecordType: 'Click', Recipient: 'bob@example.com', OriginalLink: 'https://e.com/a' },
      'clicked',
    ],
    [
      {
        RecordType: 'SubscriptionChange',
        Recipient: 'bob@example.com',
        SuppressSending: true,
        SuppressionReason: 'ManualSuppression',
        ChangedAt: '2027-01-15T08:00:00Z',
      },
      'unsubscribed',
    ],
    [
      { RecordType: 'SubscriptionChange', Recipient: 'bob@example.com', SuppressSending: false },
      'unknown',
    ],
    [{ RecordType: 'Inbound' }, 'unknown'],
  ];
  for (const [record, type] of others) {
    const { events } = await verifier.verify(posted(record));
    assert.strictEqual(events[0].type, type, record.RecordType);
  }
  const click = await verifier.verify(posted(others[2][0]));
  assert.strictEqual(click.events[0].url, 'https://e.com/a');
  assert.deepStrictEqual(click.events[0].tags, []);
  const change = await verifier.verify(posted(others[3][0]));
  assert.strictEqual(change.events[0].reason, 'ManualSuppression');
});
