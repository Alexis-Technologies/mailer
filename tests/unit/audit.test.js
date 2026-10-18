// Not ported: tests of ./audit, the states of a message and its sinks.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  auditEventOfDeliveryEvent,
  combineAuditSinks,
  createLoggerAuditSink,
  createMemoryAuditSink,
  isFinalState,
  stateOf,
  stateOfDeliveryEvent,
} = require('../../src/audit/index.js');

const eventOf = (state, extra = {}) => ({
  id: `${state}-${extra.attempt ?? 1}`,
  state,
  at: '2026-10-18T00:00:00.000Z',
  source: 'worker',
  correlationId: 'c1',
  attempt: 1,
  ...extra,
});

test('Audit: the state of a message is its furthest event, whatever their order', () => {
  assert.strictEqual(stateOf([]), undefined);
  assert.strictEqual(
    stateOf([eventOf('queued'), eventOf('rendered'), eventOf('submitted'), eventOf('accepted')]),
    'accepted',
  );
  // A retry queues it again, and its accept still counts.
  assert.strictEqual(
    stateOf([
      eventOf('submitted'),
      eventOf('queued', { attempt: 2 }),
      eventOf('accepted', { attempt: 2 }),
    ]),
    'accepted',
  );
  // A delivery event settles an unknown delivery, in either order.
  assert.strictEqual(stateOf([eventOf('delivered'), eventOf('delivery_unknown')]), 'delivered');
  assert.strictEqual(
    stateOf([eventOf('accepted'), eventOf('bounced'), eventOf('delivered')]),
    'bounced',
  );
  assert.strictEqual(stateOf([eventOf('delivered'), eventOf('complained')]), 'complained');
  // Of two as far, the later.
  assert.strictEqual(stateOf([eventOf('delivery_unknown'), eventOf('accepted')]), 'accepted');
  assert.strictEqual(stateOf([{ state: 'nonsense' }]), undefined);
  for (const state of ['delivered', 'bounced', 'complained', 'failed']) {
    assert.ok(isFinalState(state));
  }
  for (const state of ['queued', 'rendered', 'submitted', 'accepted', 'delivery_unknown']) {
    assert.ok(!isFinalState(state));
  }
});

test('Audit: delivery events tell the states that are states, not engagement', () => {
  const table = {
    accepted: 'accepted',
    deferred: 'accepted',
    delivered: 'delivered',
    bounced: 'bounced',
    complained: 'complained',
    rejected: 'failed',
    opened: undefined,
    clicked: undefined,
    unsubscribed: undefined,
    unknown: undefined,
  };
  for (const [type, state] of Object.entries(table)) {
    assert.strictEqual(stateOfDeliveryEvent({ type }), state, type);
  }
  assert.strictEqual(stateOfDeliveryEvent(undefined), undefined);
});

test('Audit: a delivery event becomes an audit event of its message, the same each time', () => {
  const delivery = {
    provider: 'resend',
    type: 'bounced',
    id: 'evt_1',
    messageId: 're_1',
    rfcMessageId: '<m@example.com>',
    correlationId: 'job-1',
    recipient: 'bob@example.com',
    occurredAt: new Date('2026-10-18T10:00:00Z'),
    bounce: { kind: 'hard', code: '5.1.1' },
    tags: ['welcome'],
    metadata: { correlationId: 'job-1' },
    raw: {},
  };
  const audit = auditEventOfDeliveryEvent(delivery);
  assert.deepStrictEqual(audit, {
    id: audit.id,
    state: 'bounced',
    at: '2026-10-18T10:00:00.000Z',
    source: 'webhook',
    correlationId: 'job-1',
    attempt: 0,
    provider: 'resend',
    providerMessageId: 're_1',
    messageId: '<m@example.com>',
    tags: ['welcome'],
    deliveryEvent: { type: 'bounced', id: 'evt_1', bounce: { kind: 'hard', code: '5.1.1' } },
  });
  assert.match(audit.id, /^[0-9a-f-]{36}$/);
  assert.strictEqual(auditEventOfDeliveryEvent(delivery).id, audit.id);
  // No recipient goes into it.
  assert.doesNotMatch(JSON.stringify(audit), /bob@example\.com/);
  // Without a correlation id, the provider's id of the message; without a
  // time, now.
  const bare = auditEventOfDeliveryEvent(
    {
      provider: 'ses',
      type: 'delivered',
      id: 'e2',
      messageId: 'ses-1',
      tags: [],
      metadata: {},
      raw: {},
    },
    { now: () => Date.parse('2026-10-18T12:00:00Z') },
  );
  assert.deepStrictEqual(
    [bare.correlationId, bare.at, bare.tags],
    ['ses-1', '2026-10-18T12:00:00.000Z', undefined],
  );
  assert.strictEqual(auditEventOfDeliveryEvent({ ...delivery, type: 'opened' }), undefined);
  assert.strictEqual(
    auditEventOfDeliveryEvent({
      provider: 'x',
      type: 'delivered',
      id: 'e',
      tags: [],
      metadata: {},
    }),
    undefined,
  );
  const now = auditEventOfDeliveryEvent({
    provider: 'x',
    type: 'delivered',
    id: 'e',
    messageId: 'm',
    tags: [],
  });
  assert.ok(Date.parse(now.at) > 0);
});

test('Audit: the memory sink writes an event once by its id, and bounds what it holds', () => {
  const sink = createMemoryAuditSink({ maxEvents: 3 });
  sink.append(eventOf('queued'));
  sink.append(eventOf('queued'));
  sink.append(eventOf('rendered'));
  sink.append(eventOf('accepted', { correlationId: 'c2' }));
  assert.deepStrictEqual(
    sink.events.map((event) => event.state),
    ['queued', 'rendered', 'accepted'],
  );
  assert.strictEqual(sink.stateOf('c1'), 'rendered');
  assert.strictEqual(sink.eventsOf('c2').length, 1);
  sink.append(eventOf('submitted'));
  assert.deepStrictEqual(
    sink.events.map((event) => event.state),
    ['rendered', 'accepted', 'submitted'],
  );
  assert.ok(Object.isFrozen(sink.events[0]));
  sink.clear();
  assert.deepStrictEqual(sink.events, []);
  assert.strictEqual(sink.stateOf('c1'), undefined);
  assert.throws(() => sink.append({}), /has an id/);
  assert.throws(() => createMemoryAuditSink({ maxEvents: 0 }), /maxEvents/);
  assert.strictEqual(createMemoryAuditSink().events.length, 0);
});

test('Audit: the logger sink writes each state at its level', () => {
  const records = [];
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (record, message) =>
      records.push([level, message, record.state, record.component]);
  }
  const sink = createLoggerAuditSink(logger, { levels: { accepted: 'warn' } });
  for (const state of [
    'queued',
    'rendered',
    'accepted',
    'failed',
    'delivery_unknown',
    'complained',
  ]) {
    sink.append(eventOf(state));
  }
  sink.append({ ...eventOf('queued'), state: 'other' });
  assert.deepStrictEqual(records, [
    ['info', 'mail.queued', 'queued', 'audit'],
    ['debug', 'mail.rendered', 'rendered', 'audit'],
    ['warn', 'mail.accepted', 'accepted', 'audit'],
    ['error', 'mail.failed', 'failed', 'audit'],
    ['warn', 'mail.delivery_unknown', 'delivery_unknown', 'audit'],
    ['warn', 'mail.complained', 'complained', 'audit'],
    ['info', 'mail.other', 'other', 'audit'],
  ]);
  assert.throws(() => createLoggerAuditSink(), /needs a logger/);
  assert.throws(
    () => createLoggerAuditSink(logger, { levels: { failed: 'loud' } }),
    /level of failed/,
  );
});

test('Audit: combined sinks are each told, whatever another throws', async () => {
  const told = [];
  const ok = { append: (event) => told.push(['ok', event.state]) };
  const broken = {
    append: async () => {
      throw new Error('store down');
    },
  };
  const context = { transaction: 'tx' };
  const contexts = [];
  const spy = { append: (event, given) => contexts.push(given) };
  await combineAuditSinks(ok, spy).append(eventOf('queued'), context);
  assert.deepStrictEqual(contexts, [context]);
  await assert.rejects(combineAuditSinks(broken, ok).append(eventOf('rendered')), /store down/);
  assert.deepStrictEqual(told, [
    ['ok', 'queued'],
    ['ok', 'rendered'],
  ]);
  const twice = await combineAuditSinks(broken, broken)
    .append(eventOf('x'))
    .catch((error) => error);
  assert.ok(twice instanceof AggregateError);
  assert.strictEqual(twice.errors.length, 2);
  assert.throws(() => combineAuditSinks(ok, {}), /has append/);
});

test('Audit: a sink tells whether it holds an event, combined ones if any can', async () => {
  const memory = createMemoryAuditSink();
  memory.append({ id: 'e1', state: 'submitted', correlationId: 'c' });
  assert.deepStrictEqual([memory.has('e1'), memory.has('e2')], [true, false]);
  const blind = { append: () => {} };
  assert.strictEqual(combineAuditSinks(blind, blind).has, undefined);
  const combined = combineAuditSinks(blind, memory);
  assert.deepStrictEqual([await combined.has('e1'), await combined.has('e2')], [true, false]);
});
