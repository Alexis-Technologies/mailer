// Not ported: tests of the MailerSend, Mailtrap, Brevo, Mailjet and SparkPost
// verifiers of ./webhooks, against requests made as each provider documents.
const { test } = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('node:crypto');
const {
  createBrevoWebhookVerifier,
  createMemoryReplayStore,
  createMailerSendWebhookVerifier,
  createMailjetWebhookVerifier,
  createMailtrapWebhookVerifier,
  createSparkPostWebhookVerifier,
  WebhookVerificationError,
} = require('../../src/webhooks/index.js');

const rejects = async (promise, reason) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof WebhookVerificationError, String(error));
    assert.strictEqual(error.reason, reason, error.message);
    return true;
  });
};
const hmac = (secret, body) => createHmac('sha256', secret).update(body).digest('hex');
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const plain = (event) => ({ ...event, metadata: { ...event.metadata } });

test('Webhooks MailerSend: the HMAC of the body, an event taken once', async () => {
  const verifier = createMailerSendWebhookVerifier({
    secret: 'ms-secret',
    replayStore: createMemoryReplayStore(),
  });
  const payload = {
    type: 'activity.hard_bounced',
    created_at: '2027-01-15T08:00:00.000000Z',
    data: {
      id: 'act-1',
      message_id: 'msg-1',
      recipient: 'bob@example.com',
      tags: ['orders'],
      created_at: '2027-01-15T07:59:00.000000Z',
      meta: { bounce_code: 550, bounce_reason: 'Mailbox not found', bounce_type: 'hard' },
      headers: [
        { name: 'X-Metadata-orderId', value: '42' },
        { name: 'X-Other', value: 'x' },
      ],
    },
  };
  const body = JSON.stringify(payload);
  const delivery = await verifier.verify({
    body,
    headers: { Signature: hmac('ms-secret', body) },
  });
  const { events } = delivery;
  assert.deepStrictEqual(plain(events[0]), {
    provider: 'mailersend',
    type: 'bounced',
    id: 'act-1:activity.hard_bounced',
    messageId: 'msg-1',
    recipient: 'bob@example.com',
    occurredAt: new Date('2027-01-15T07:59:00.000Z'),
    bounce: { kind: 'hard', code: '550', diagnostic: 'Mailbox not found' },
    reason: 'Mailbox not found',
    tags: ['orders'],
    metadata: { orderId: '42' },
    raw: payload,
  });
  await delivery.commit();
  await rejects(
    verifier.verify({ body, headers: { Signature: hmac('ms-secret', body) } }),
    'replay',
  );
  await rejects(
    verifier.verify({ body, headers: { Signature: hmac('other', body) } }),
    'signature',
  );
  await rejects(verifier.verify({ body, headers: {} }), 'signature');
  // The nested form of MailerSend's activity.
  const nested = {
    type: 'activity.clicked_unique',
    created_at: '2027-01-15T08:00:00Z',
    data: {
      id: 'act-2',
      email: {
        message: { id: 'msg-2' },
        recipient: { email: 'carol@example.com' },
        tags: ['news'],
        headers: { 'X-Metadata-tenant': 'acme' },
      },
      morph: { url: 'https://e.com/a' },
    },
  };
  const nestedBody = JSON.stringify(nested);
  const clicked = await verifier.verify({
    body: nestedBody,
    headers: { signature: hmac('ms-secret', nestedBody) },
  });
  assert.strictEqual(clicked.events[0].type, 'clicked');
  assert.strictEqual(clicked.events[0].messageId, 'msg-2');
  assert.strictEqual(clicked.events[0].recipient, 'carol@example.com');
  assert.strictEqual(clicked.events[0].url, 'https://e.com/a');
  assert.deepStrictEqual({ ...clicked.events[0].metadata }, { tenant: 'acme' });
  for (const [type, expected] of [
    ['activity.sent', 'accepted'],
    ['activity.soft_bounced', 'bounced'],
    ['activity.suppressed', 'rejected'],
    ['activity.unsubscribed', 'unsubscribed'],
    ['activity.spam_complaint', 'complained'],
    ['activity.survey_opened', 'unknown'],
  ]) {
    const typed = JSON.stringify({ type, created_at: type, data: {} });
    const { events: typedEvents } = await verifier.verify({
      body: typed,
      headers: { signature: hmac('ms-secret', typed) },
    });
    assert.strictEqual(typedEvents[0].type, expected, type);
  }
  const soft = JSON.stringify({ type: 'activity.soft_bounced', data: { id: 's' } });
  const softEvents = await verifier.verify({
    body: soft,
    headers: { signature: hmac('ms-secret', soft) },
  });
  assert.deepStrictEqual(softEvents.events[0].bounce, { kind: 'soft' });
  const notEvent = JSON.stringify([1]);
  await rejects(
    verifier.verify({ body: notEvent, headers: { signature: hmac('ms-secret', notEvent) } }),
    'payload',
  );
  assert.throws(() => createMailerSendWebhookVerifier({}), /secret/);
});

test('Webhooks Mailtrap: a signed batch, in JSON or JSON Lines, each event once', async () => {
  const verifier = createMailtrapWebhookVerifier({
    secret: 'mt-secret',
    replayStore: createMemoryReplayStore(),
  });
  const delivery = {
    event: 'delivery',
    message_id: 'mt-1',
    event_id: 'ev-1',
    email: 'bob@example.com',
    timestamp: 1_800_000_000,
    category: 'orders',
    custom_variables: { tag_eu: 'eu', orderId: '42', attempt: 2 },
  };
  const bounce = {
    event: 'bounce',
    message_id: 'mt-1',
    event_id: 'ev-2',
    email: 'carol@example.com',
    response: '550 unknown',
    response_code: 550,
    bounce_category: 'invalid',
  };
  const body = JSON.stringify({ events: [delivery, bounce] });
  const taken = await verifier.verify({
    body,
    headers: { 'Mailtrap-Signature': hmac('mt-secret', body) },
  });
  const { events } = taken;
  assert.deepStrictEqual(plain(events[0]), {
    provider: 'mailtrap',
    type: 'delivered',
    id: 'ev-1',
    messageId: 'mt-1',
    recipient: 'bob@example.com',
    occurredAt: new Date(1_800_000_000_000),
    tags: ['orders', 'eu'],
    metadata: { orderId: '42', attempt: '2' },
    raw: delivery,
  });
  assert.deepStrictEqual(events[1].bounce, {
    kind: 'hard',
    code: '550',
    diagnostic: '550 unknown',
  });
  assert.strictEqual(events[1].reason, 'invalid');
  await taken.commit();
  await rejects(
    verifier.verify({ body, headers: { 'Mailtrap-Signature': hmac('mt-secret', body) } }),
    'replay',
  );
  const lines = [
    { event: 'soft bounce', event_id: 'ev-3', email: 'bob@example.com' },
    { event: 'click', event_id: 'ev-4', url: 'https://e.com/a' },
    { event: 'suspension', event_id: 'ev-5', reason: 'domain suspended' },
    { event: 'spam', event_id: 'ev-6' },
    { event: 'unsubscribe', event_id: 'ev-7' },
    { event: 'open', event_id: 'ev-8' },
    { event: 'reject', event_id: 'ev-9' },
    { event: 'later', message_id: 'mt-2', email: 'x@example.com' },
    { event: 'delivery', event_id: 'ev-1' },
  ];
  const jsonl = `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
  const fromLines = await verifier.verify({
    body: jsonl,
    headers: { 'mailtrap-signature': hmac('mt-secret', jsonl) },
  });
  assert.deepStrictEqual(
    fromLines.events.map((event) => event.type),
    [
      'bounced',
      'clicked',
      'rejected',
      'complained',
      'unsubscribed',
      'opened',
      'rejected',
      'unknown',
    ],
  );
  assert.strictEqual(fromLines.events[0].bounce.kind, 'soft');
  assert.strictEqual(fromLines.events[7].id, 'mt-2:later:x@example.com');
  const single = JSON.stringify({ event: 'delivery', event_id: 'ev-single' });
  assert.strictEqual(
    (
      await verifier.verify({
        body: single,
        headers: { 'mailtrap-signature': hmac('mt-secret', single) },
      })
    ).events.length,
    1,
  );
  const numbers = '[1, 2]';
  await rejects(
    verifier.verify({
      body: numbers,
      headers: { 'mailtrap-signature': hmac('mt-secret', numbers) },
    }),
    'payload',
  );
  const broken = '{"event":\n"x"';
  await rejects(
    verifier.verify({ body: broken, headers: { 'mailtrap-signature': hmac('mt-secret', broken) } }),
    'payload',
  );
  const scalars = '1\n2\n';
  assert.deepStrictEqual(
    (
      await verifier.verify({
        body: scalars,
        headers: { 'mailtrap-signature': hmac('mt-secret', scalars) },
      })
    ).events,
    [],
  );
  assert.throws(() => createMailtrapWebhookVerifier({}), /secret/);
});

test('Webhooks Brevo: the configured token is required', async () => {
  const verifier = createBrevoWebhookVerifier({ token: 'brevo-token' });
  const record = {
    event: 'hard_bounce',
    email: 'bob@example.com',
    'message-id': '<1@smtp-relay.mailin.fr>',
    ts_event: 1_800_000_000,
    reason: 'unknown user',
    tags: ['orders'],
    'X-Mailin-custom': '{"orderId":"42"}',
  };
  const body = JSON.stringify(record);
  // Changed in the port: sently parsed any request.
  const { events } = await verifier.verify({
    body,
    headers: { Authorization: 'Bearer brevo-token' },
  });
  assert.deepStrictEqual(plain(events[0]), {
    provider: 'brevo',
    type: 'bounced',
    id: 'hard_bounce:<1@smtp-relay.mailin.fr>:bob@example.com:1800000000',
    messageId: '<1@smtp-relay.mailin.fr>',
    recipient: 'bob@example.com',
    occurredAt: new Date(1_800_000_000_000),
    bounce: { kind: 'hard', diagnostic: 'unknown user' },
    reason: 'unknown user',
    tags: ['orders'],
    metadata: { orderId: '42' },
    raw: record,
  });
  await rejects(
    verifier.verify({ body, headers: { Authorization: 'Bearer other' } }),
    'credentials',
  );
  await rejects(verifier.verify({ body, headers: {} }), 'credentials');
  const custom = createBrevoWebhookVerifier({ token: 't0k', header: 'X-Webhook-Token' });
  const batch = JSON.stringify([
    { event: 'softBounce', email: 'a@example.com' },
    // Changed in the port: sently took these for a complaint and bounces.
    { event: 'unsubscribed', email: 'a@example.com' },
    { event: 'blocked', email: 'a@example.com' },
    { event: 'invalid_email', email: 'a@example.com' },
    { event: 'click', link: 'https://e.com/a', tag: 'single' },
    { event: 'uniqueOpened', 'X-Mailin-custom': 'not json' },
    { event: 'request' },
    { event: 'mystery' },
    'skipped',
  ]);
  const many = await custom.verify({ body: batch, headers: { 'x-webhook-token': 't0k' } });
  assert.deepStrictEqual(
    many.events.map((event) => event.type),
    ['bounced', 'unsubscribed', 'rejected', 'rejected', 'clicked', 'opened', 'accepted', 'unknown'],
  );
  assert.strictEqual(many.events[0].bounce.kind, 'soft');
  assert.deepStrictEqual(many.events[4].tags, ['single']);
  assert.strictEqual(many.events[4].url, 'https://e.com/a');
  assert.deepStrictEqual({ ...many.events[5].metadata }, {});
  await rejects(custom.verify({ body: '"x"', headers: { 'x-webhook-token': 't0k' } }), 'payload');
  assert.throws(() => createBrevoWebhookVerifier({}), /token is required/);
  assert.throws(() => createBrevoWebhookVerifier({ token: 't', header: '' }), /header/);
});

test('Webhooks Mailjet: Basic credentials are required; the MessageUUID is the id', async () => {
  const verifier = createMailjetWebhookVerifier({ username: 'mj', password: 'pw' });
  const record = {
    event: 'bounce',
    time: 1_800_000_000,
    MessageID: 1234,
    Message_GUID: 'uuid-1',
    email: 'bob@example.com',
    customcampaign: 'autumn',
    Payload: '{"orderId":"42"}',
    hard_bounce: true,
    error: 'user unknown',
  };
  const body = JSON.stringify(record);
  const { events } = await verifier.verify({ body, headers: { authorization: basic('mj', 'pw') } });
  assert.deepStrictEqual(plain(events[0]), {
    provider: 'mailjet',
    type: 'bounced',
    id: 'bounce:uuid-1:bob@example.com:1800000000',
    messageId: 'uuid-1',
    recipient: 'bob@example.com',
    occurredAt: new Date(1_800_000_000_000),
    bounce: { kind: 'hard', diagnostic: 'user unknown' },
    reason: 'user unknown',
    tags: ['autumn'],
    metadata: { orderId: '42' },
    raw: record,
  });
  await rejects(
    verifier.verify({ body, headers: { authorization: basic('mj', 'no') } }),
    'credentials',
  );
  const batch = JSON.stringify([
    { event: 'sent', MessageID: 7 },
    { event: 'bounce', hard_bounce: false },
    { event: 'blocked', error: 'preblocked' },
    { event: 'spam', source: 'JMRPP' },
    { event: 'unsub' },
    { event: 'open' },
    { event: 'click', url: 'https://e.com/a' },
    { event: 'other' },
  ]);
  const many = await verifier.verify({
    body: batch,
    headers: { authorization: basic('mj', 'pw') },
  });
  assert.deepStrictEqual(
    many.events.map((event) => event.type),
    [
      'delivered',
      'bounced',
      'rejected',
      'complained',
      'unsubscribed',
      'opened',
      'clicked',
      'unknown',
    ],
  );
  assert.strictEqual(many.events[0].messageId, '7');
  assert.deepStrictEqual(many.events[1].bounce, { kind: 'soft' });
  assert.strictEqual(many.events[3].reason, 'JMRPP');
  await rejects(
    verifier.verify({ body: '[]', headers: { authorization: basic('mj', 'pw') } }),
    'payload',
  );
  assert.throws(() => createMailjetWebhookVerifier({ username: 'mj' }), /password is required/);
});

test('Webhooks SparkPost: Basic credentials are required; the transmission is the message', async () => {
  const verifier = createSparkPostWebhookVerifier({ username: 'sp', password: 'pw' });
  const bounce = {
    type: 'bounce',
    event_id: 'ev-1',
    transmission_id: 'tx-1',
    rcpt_to: 'bob@example.com',
    timestamp: '1800000000',
    bounce_class: '10',
    error_code: '550',
    raw_reason: '550 5.1.1 unknown',
    reason: '550 5.1.1 unknown',
    rcpt_tags: ['orders'],
    rcpt_meta: { orderId: '42' },
  };
  const body = JSON.stringify([{ msys: { message_event: bounce } }, { msys: {} }, 'x']);
  const { events } = await verifier.verify({ body, headers: { Authorization: basic('sp', 'pw') } });
  assert.strictEqual(events.length, 1);
  assert.deepStrictEqual(plain(events[0]), {
    provider: 'sparkpost',
    type: 'bounced',
    id: 'ev-1',
    messageId: 'tx-1',
    recipient: 'bob@example.com',
    occurredAt: new Date(1_800_000_000_000),
    bounce: { kind: 'hard', code: '550', diagnostic: '550 5.1.1 unknown' },
    reason: '550 5.1.1 unknown',
    tags: ['orders'],
    metadata: { orderId: '42' },
    raw: bounce,
  });
  await rejects(verifier.verify({ body, headers: {} }), 'credentials');
  const kinds = [
    [{ type: 'bounce', bounce_class: 21 }, 'bounced', 'soft'],
    [{ type: 'out_of_band', bounce_class: '1' }, 'bounced', 'undetermined'],
    [{ type: 'bounce' }, 'bounced', 'undetermined'],
    [{ type: 'injection' }, 'accepted', undefined],
    [{ type: 'delivery' }, 'delivered', undefined],
    [{ type: 'delay' }, 'deferred', undefined],
    [{ type: 'policy_rejection' }, 'rejected', undefined],
    [{ type: 'spam_complaint' }, 'complained', undefined],
    [{ type: 'link_unsubscribe' }, 'unsubscribed', undefined],
    [{ type: 'initial_open' }, 'opened', undefined],
    [{ type: 'click', target_link_url: 'https://e.com/a' }, 'clicked', undefined],
    [{ type: 'sms_status' }, 'unknown', undefined],
  ];
  const batch = [];
  for (const [inner] of kinds) batch.push({ msys: { track_event: inner } });
  const many = await verifier.verify({
    body: JSON.stringify(batch),
    headers: { Authorization: basic('sp', 'pw') },
  });
  for (let i = 0; i < kinds.length; i++) {
    assert.strictEqual(many.events[i].type, kinds[i][1], kinds[i][0].type);
    assert.strictEqual(many.events[i].bounce?.kind, kinds[i][2], kinds[i][0].type);
  }
  assert.strictEqual(many.events[3].id, 'undefined:injection:3');
  assert.strictEqual(many.events[10].url, 'https://e.com/a');
  await rejects(
    verifier.verify({ body: '{}', headers: { Authorization: basic('sp', 'pw') } }),
    'payload',
  );
  assert.throws(() => createSparkPostWebhookVerifier({}), /username is required/);
});
