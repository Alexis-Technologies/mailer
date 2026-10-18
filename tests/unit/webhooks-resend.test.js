// Not ported: tests of the Resend verifier of ./webhooks, ported from sently's
// Resend webhook, with requests signed as Svix signs them.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  createMemoryReplayStore,
  createResendWebhookVerifier,
  WebhookVerificationError,
} = require('../../src/webhooks/index.js');
const { SECRET, signSvix } = require('../helpers/webhooks/svix.js');

const NOW = 1_800_000_000_000;
const verifier = (options = {}) =>
  createResendWebhookVerifier({
    secret: SECRET,
    now: () => NOW,
    replayStore: createMemoryReplayStore({ now: () => NOW }),
    ...options,
  });
const event = (type, data = {}) =>
  JSON.stringify({
    type,
    created_at: '2027-01-15T08:00:00.000Z',
    data: {
      email_id: 'e-1',
      created_at: '2027-01-15T07:59:59.000Z',
      to: ['bob@example.com', 'carol@example.com'],
      tags: { tag2: 'eu', tag1: 'orders', orderId: '42' },
      ...data,
    },
  });

const rejects = async (promise, reason) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof WebhookVerificationError, String(error));
    assert.strictEqual(error.reason, reason, error.message);
    return true;
  });
};

test('Webhooks Resend: the vector of the Svix documentation verifies', async () => {
  const resend = createResendWebhookVerifier({
    secret: SECRET,
    now: () => 1_614_265_330_000,
    replayStore: null,
  });
  const { events } = await resend.verify({
    body: '{"test": 2432232314}',
    headers: {
      'svix-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'svix-timestamp': '1614265330',
      'svix-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    },
  });
  assert.strictEqual(events[0].type, 'unknown');
  assert.strictEqual(events[0].id, 'msg_p5jXN8AQM9LWM0D4loKWxJek:0');
});

test('Webhooks Resend: a bounce is an event per recipient, with its kind', async () => {
  const body = event('email.bounced', {
    bounce: { message: 'Mailbox does not exist', subType: 'General', type: 'Permanent' },
  });
  const { events } = await verifier().verify(signSvix(body, 'msg_b'));
  assert.strictEqual(events.length, 2);
  assert.deepStrictEqual(
    { ...events[1], metadata: { ...events[1].metadata } },
    {
      provider: 'resend',
      type: 'bounced',
      id: 'msg_b:1',
      messageId: 'e-1',
      recipient: 'carol@example.com',
      occurredAt: new Date('2027-01-15T08:00:00.000Z'),
      bounce: { kind: 'hard', diagnostic: 'Mailbox does not exist' },
      reason: 'General',
      tags: ['orders', 'eu'],
      metadata: { orderId: '42' },
      raw: JSON.parse(body),
    },
  );
});

test('Webhooks Resend: every type of email event', async () => {
  const resend = verifier();
  const cases = [
    ['email.sent', 'accepted'],
    ['email.scheduled', 'accepted'],
    ['email.delivered', 'delivered'],
    ['email.delivery_delayed', 'deferred'],
    ['email.complained', 'complained'],
    ['email.opened', 'opened'],
    // Changed in the port: sently took a failure for a bounce, and knew no suppression.
    ['email.failed', 'rejected'],
    ['email.suppressed', 'rejected'],
    ['email.received', 'unknown'],
  ];
  for (let i = 0; i < cases.length; i++) {
    const { events } = await resend.verify(signSvix(event(cases[i][0]), `msg_${i}`));
    assert.strictEqual(events[0].type, cases[i][1], cases[i][0]);
  }
  const click = await resend.verify(
    signSvix(
      event('email.clicked', { to: 'bob@example.com', click: { link: 'https://e.com/a' } }),
      'msg_c',
    ),
  );
  assert.strictEqual(click.events.length, 1);
  assert.strictEqual(click.events[0].url, 'https://e.com/a');
  const failed = await resend.verify(
    signSvix(event('email.failed', { failed: { reason: 'reached_daily_quota' } }), 'msg_f'),
  );
  assert.strictEqual(failed.events[0].reason, 'reached_daily_quota');
  const soft = await resend.verify(
    signSvix(event('email.bounced', { bounce: { type: 'Transient' } }), 'msg_s'),
  );
  assert.strictEqual(soft.events[0].bounce.kind, 'soft');
  const bare = await resend.verify(
    signSvix(JSON.stringify({ type: 'email.bounced', data: { bounce: {} } }), 'msg_e'),
  );
  assert.deepStrictEqual(bare.events[0].bounce, { kind: 'undetermined' });
  assert.strictEqual(bare.events[0].recipient, undefined);
  assert.deepStrictEqual(bare.events[0].tags, []);
  const nothing = await resend.verify(signSvix(JSON.stringify({ type: 'email.sent' }), 'msg_n'));
  assert.strictEqual(nothing.events[0].messageId, undefined);
});

test('Webhooks Resend: a forged, old or repeated request is refused', async () => {
  // Changed in the port: sently took any time and any replay.
  const resend = verifier();
  const body = event('email.delivered');
  const signed = signSvix(body, 'msg_r');
  await rejects(resend.verify({ ...signed, body: event('email.bounced') }), 'signature');
  await rejects(resend.verify({ body, headers: {} }), 'signature');
  await rejects(
    resend.verify({ body, headers: { ...signed.headers, 'svix-signature': 'v2,abc v1,' } }),
    'signature',
  );
  await rejects(resend.verify(signSvix(body, 'msg_old', '1799999000')), 'timestamp');
  await rejects(resend.verify(signSvix(body, 'msg_bad', 'soon')), 'timestamp');
  await (await resend.verify(signed)).commit();
  await rejects(resend.verify(signed), 'replay');
  await rejects(resend.verify(signSvix('[1]', 'msg_array')), 'payload');
  // Standard Webhooks names its headers webhook-*.
  const standard = signSvix(body, 'msg_std');
  const headers = new Headers({
    'webhook-id': 'msg_std',
    'webhook-timestamp': standard.headers['svix-timestamp'],
    'webhook-signature': standard.headers['svix-signature'],
  });
  assert.strictEqual((await resend.verify({ body: Buffer.from(body), headers })).events.length, 2);
});

test('Webhooks Resend: a secret that is not one is refused when the verifier is made', () => {
  // Changed in the port: sently's atob threw at each request.
  assert.throws(() => createResendWebhookVerifier({}), /signing secret/);
  assert.throws(() => createResendWebhookVerifier({ secret: 'whsec_not base64!' }), /base64/);
  assert.throws(() => createResendWebhookVerifier({ secret: 'whsec_' }), /base64/);
  assert.ok(createResendWebhookVerifier({ secret: SECRET.slice(6), replayStore: null }));
});
