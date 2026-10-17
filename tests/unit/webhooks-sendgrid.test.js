// Not ported: tests of the SendGrid verifier of ./webhooks, ported from
// sently's SendGrid webhook, with a P-256 key made for the test.
const { test } = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync, sign } = require('node:crypto');
const {
  createMemoryReplayStore,
  createSendGridWebhookVerifier,
  WebhookVerificationError,
} = require('../../src/webhooks/index.js');

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PUBLIC_KEY = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const NOW = 1_800_000_000_000;

const signed = (events, timestamp = '1800000000') => {
  const body = JSON.stringify(events);
  const signature = sign('sha256', Buffer.from(timestamp + body), privateKey).toString('base64');
  return {
    body,
    headers: {
      'X-Twilio-Email-Event-Webhook-Signature': signature,
      'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
    },
  };
};
const verifier = (options = {}) =>
  createSendGridWebhookVerifier({
    publicKey: PUBLIC_KEY,
    now: () => NOW,
    replayStore: createMemoryReplayStore({ now: () => NOW }),
    ...options,
  });
const record = (event, fields = {}) => ({
  email: 'bob@example.com',
  timestamp: 1_799_999_990,
  event,
  sg_event_id: `ev-${event}`,
  sg_message_id: 'x-msg-1.filterdrecv-5645d9c87f-2qbs9-1-5E3E2C3D-1.0',
  category: ['orders', 'eu'],
  orderId: '42',
  ...fields,
});

const rejects = async (promise, reason) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof WebhookVerificationError, String(error));
    assert.strictEqual(error.reason, reason, error.message);
    return true;
  });
};

test('Webhooks SendGrid: a signed batch is an event per record', async () => {
  const records = [
    record('bounce', {
      status: '5.1.1',
      reason: '550 5.1.1 unknown user',
      bounce_classification: 'Invalid Address',
    }),
    record('bounce', { sg_event_id: 'ev-blocked', type: 'blocked', reason: 'IP blocked' }),
  ];
  const { events } = await verifier().verify(signed(records));
  assert.deepStrictEqual(
    { ...events[0], metadata: { ...events[0].metadata } },
    {
      provider: 'sendgrid',
      type: 'bounced',
      id: 'ev-bounce',
      messageId: 'x-msg-1',
      recipient: 'bob@example.com',
      occurredAt: new Date(1_799_999_990_000),
      bounce: { kind: 'hard', code: '5.1.1', diagnostic: '550 5.1.1 unknown user' },
      reason: 'Invalid Address',
      tags: ['orders', 'eu'],
      metadata: { orderId: '42' },
      raw: records[0],
    },
  );
  // Changed in the port: sently took a block for a deferral.
  assert.strictEqual(events[1].type, 'bounced');
  assert.strictEqual(events[1].bounce.kind, 'soft');
});

test('Webhooks SendGrid: every type of event', async () => {
  const cases = [
    ['processed', 'accepted'],
    ['delivered', 'delivered'],
    ['deferred', 'deferred'],
    // Changed in the port: sently took a drop for a bounce, an unsubscribe for a complaint.
    ['dropped', 'rejected'],
    ['spamreport', 'complained'],
    ['unsubscribe', 'unsubscribed'],
    ['group_unsubscribe', 'unsubscribed'],
    ['group_resubscribe', 'unknown'],
    ['open', 'opened'],
    ['click', 'clicked'],
  ];
  const records = [];
  for (const [event] of cases) records.push(record(event));
  records.push(
    record('click', { sg_event_id: 'ev-url', url: 'https://e.com/a', category: 'single' }),
  );
  records.push(record('delivered', { sg_event_id: undefined, sg_message_id: 'plain-id' }));
  records.push('not a record');
  const { events } = await verifier().verify(signed(records));
  assert.deepStrictEqual(
    events.slice(0, cases.length).map((event) => event.type),
    cases.map((entry) => entry[1]),
  );
  assert.strictEqual(events[cases.length].url, 'https://e.com/a');
  assert.deepStrictEqual(events[cases.length].tags, ['single']);
  assert.strictEqual(events[cases.length + 1].id, '1800000000:11');
  assert.strictEqual(events[cases.length + 1].messageId, 'plain-id');
  const bare = await verifier().verify(signed([{ event: 'delivered', sg_event_id: 'bare' }]));
  assert.deepStrictEqual(bare.events[0].tags, []);
  assert.strictEqual(bare.events[0].messageId, undefined);
});

test('Webhooks SendGrid: a forged, old or repeated batch is refused', async () => {
  // Changed in the port: sently verified nothing.
  const sendgrid = verifier();
  const good = signed([record('delivered'), record('open')]);
  await rejects(sendgrid.verify({ ...good, body: good.body.replace('bob', 'eve') }), 'signature');
  await rejects(sendgrid.verify({ body: good.body, headers: {} }), 'signature');
  await rejects(sendgrid.verify(signed([record('delivered')], '1799999000')), 'timestamp');
  await rejects(sendgrid.verify(signed([record('delivered')], 'later')), 'timestamp');
  const first = await sendgrid.verify(good);
  assert.strictEqual(first.events.length, 2);
  await first.commit();
  await rejects(sendgrid.verify(good), 'replay');
  // A batch sent again with a new event keeps the new one alone.
  const more = await sendgrid.verify(signed([record('delivered'), record('click')]));
  assert.deepStrictEqual(
    more.events.map((event) => event.type),
    ['clicked'],
  );
  await rejects(sendgrid.verify(signed({ event: 'delivered' })), 'payload');
  const failing = verifier({
    replayStore: {
      reserve: () => {
        throw new WebhookVerificationError('payload', 'store down');
      },
      commit: () => {},
      release: () => {},
    },
  });
  await rejects(failing.verify(signed([record('delivered')])), 'payload');
});

test('Webhooks SendGrid: the key may be PEM, and one that is not a key is refused', async () => {
  const pem = publicKey.export({ format: 'pem', type: 'spki' });
  const fromPem = createSendGridWebhookVerifier({
    publicKey: pem,
    now: () => NOW,
    replayStore: null,
  });
  assert.strictEqual((await fromPem.verify(signed([record('delivered')]))).events.length, 1);
  assert.throws(() => createSendGridWebhookVerifier({}), /publicKey is the verification key/);
  assert.throws(
    () => createSendGridWebhookVerifier({ publicKey: 'bm90IGEga2V5' }),
    /not a public key/,
  );
});
