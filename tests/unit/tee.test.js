// Not ported: tests of ./tee, ported from unemail's tee driver, against fake
// transports.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { TeeTransport } = require('../../src/tee/index.js');
const { collect, failed, fakeTransport, sent } = require('../helpers/decorators/fake.js');

const message = (subject = 'Hello') =>
  createMessage({ from: 'a@example.com', to: 'b@example.com', subject, content: { text: 'x' } });

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Waits until a condition holds, for a timer that a busy machine may delay.
const waitFor = async (condition) => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

// A mirror that answers only when its signal aborts.
const hanging = () =>
  fakeTransport(
    (_m, _index, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason));
      }),
  );

test('Tee: the primary answers at once; a hung mirror is cut by its own timeout', async () => {
  const primary = fakeTransport((_m, index) => sent(`p${index}`));
  const mirror = hanging();
  const outcomes = [];
  const tee = new TeeTransport(primary, {
    mirrors: [mirror],
    timeout: 20,
    onMirror: (outcome) => outcomes.push(outcome),
  });
  // Changed in the port: unemail awaited every leg with no bound.
  const receipt = await tee.send(message());
  assert.strictEqual(receipt.messageId, 'p0');
  assert.strictEqual(outcomes.length, 0);
  assert.strictEqual(mirror.calls.length, 1);
  await waitFor(() => outcomes.length === 1);
  assert.strictEqual(outcomes[0].mirror, 'fake');
  assert.strictEqual(outcomes[0].error.name, 'TimeoutError');
});

test('Tee: awaitMirrors waits for them, bounded, and they follow the caller', async () => {
  const primary = fakeTransport(() => sent('p'));
  const good = fakeTransport(() => sent('copy'));
  const bad = fakeTransport(() => failed('network'));
  const outcomes = [];
  const tee = new TeeTransport(primary, {
    mirrors: [good, bad, hanging()],
    awaitMirrors: true,
    timeout: 20,
    onMirror: (outcome) =>
      outcomes.push(
        outcome.receipt?.messageId ?? outcome.receipt?.errors[0].category ?? outcome.error.name,
      ),
  });
  assert.strictEqual((await tee.send(message())).messageId, 'p');
  assert.deepStrictEqual(outcomes.sort(), ['TimeoutError', 'copy', 'network'].sort());
  const controller = new AbortController();
  const caller = new TeeTransport(primary, {
    mirrors: [hanging()],
    awaitMirrors: true,
    onMirror: (outcome) => outcomes.push(outcome.error.message),
  });
  const pending = caller.send(message(), { signal: controller.signal });
  await settle();
  controller.abort(new Error('caller left'));
  await pending;
  assert.strictEqual(outcomes.at(-1), 'caller left');
});

test('Tee: a mirror never changes the primary, which alone throws', async (t) => {
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text, options) => warnings.push([text, options.code]));
  const primary = fakeTransport((m) =>
    m.subject === 'boom' ? { throw: new Error('primary down') } : sent('p'),
  );
  const thrower = fakeTransport(() => ({ throw: 'mirror down' }));
  const failing = fakeTransport(() => failed('timeout'));
  const tee = new TeeTransport(primary, { mirrors: [thrower, failing], awaitMirrors: true });
  assert.strictEqual((await tee.send(message())).messageId, 'p');
  await assert.rejects(tee.send(message('boom')), /primary down/);
  assert.deepStrictEqual(warnings.slice(0, 2), [
    ['The mirror fake failed: mirror down', 'MAILER_TEE_MIRROR_FAILED'],
    ['The mirror fake failed: timeout failure', 'MAILER_TEE_MIRROR_FAILED'],
  ]);
  const listening = new TeeTransport(primary, {
    mirrors: [failing],
    awaitMirrors: true,
    onMirror: () => {
      throw new Error('listener broke');
    },
  });
  await listening.send(message());
  assert.deepStrictEqual(warnings.at(-1), [
    'The onMirror of TeeTransport threw: listener broke',
    'MAILER_TEE_LISTENER_FAILED',
  ]);
});

test('Tee: detached copies in flight are bounded', async () => {
  const primary = fakeTransport(() => sent('p'));
  const slow = hanging();
  const outcomes = [];
  const tee = new TeeTransport(primary, {
    mirrors: [slow],
    maxPending: 2,
    timeout: 20,
    onMirror: (outcome) => outcomes.push(outcome.skipped ?? outcome.error.name),
  });
  for (let i = 0; i < 3; i++) await tee.send(message());
  assert.strictEqual(slow.calls.length, 2);
  assert.deepStrictEqual(outcomes, ['2 mirrored sends are in flight']);
  await waitFor(() => outcomes.length === 3);
  await tee.send(message());
  assert.strictEqual(slow.calls.length, 3);
});

test('Tee: sendMany mirrors each message handed to the primary', async () => {
  const primary = fakeTransport(undefined, { readAhead: 1 });
  const mirror = fakeTransport(() => sent('copy'));
  const tee = new TeeTransport(primary, { mirrors: [mirror], awaitMirrors: true });
  const receipts = await collect(tee.sendMany([message('a'), message('b'), message('c')]));
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.messageId),
    ['m0', 'm1', 'm2'],
  );
  assert.deepStrictEqual(
    mirror.calls.map((call) => call.message.subject),
    ['a', 'b', 'c'],
  );
  assert.ok(primary.calls.every((call) => call.operation === 'sendMany'));
});

test('Tee: sendRaw goes to the mirrors that send raw, verify and dispose', async (t) => {
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text, options) => warnings.push([text, options.code]));
  const primary = fakeTransport();
  const rawMirror = fakeTransport(() => sent('copy'));
  const plainMirror = { id: 'plain', send: async () => sent('x') };
  const tee = new TeeTransport(primary, {
    mirrors: [rawMirror, plainMirror, rawMirror],
    awaitMirrors: true,
  });
  const raw = { envelope: { from: 'a@example.com', to: ['b@example.com'] }, content: 'x' };
  assert.strictEqual((await tee.sendRaw(raw)).messageId, 'm0');
  assert.strictEqual(rawMirror.calls.filter((call) => call.operation === 'sendRaw').length, 2);
  assert.deepStrictEqual(warnings, [
    ['The mirror plain failed: it does not send raw messages', 'MAILER_TEE_MIRROR_FAILED'],
  ]);
  await tee.verify();
  assert.strictEqual(primary.verified, 1);
  await tee[Symbol.asyncDispose]();
  // Each transport once, the repeated mirror too.
  assert.strictEqual(primary.disposed, 1);
  assert.strictEqual(rawMirror.disposed, 1);
  const bare = new TeeTransport(plainMirror, { mirrors: [rawMirror] });
  assert.strictEqual((await bare.sendRaw(raw)).errors[0].category, 'configuration');
  await bare.verify();
  const broken = {
    id: 'broken',
    send: async () => sent('b'),
    [Symbol.dispose]: () => {
      throw new Error('cannot close');
    },
  };
  await assert.rejects(
    new TeeTransport(broken, { mirrors: [rawMirror] })[Symbol.asyncDispose](),
    (error) => error instanceof AggregateError && error.errors[0].message === 'cannot close',
  );
  await assert.rejects(
    bare.send(message(), { signal: AbortSignal.abort(new Error('already')) }),
    /already/,
  );
});

test('Tee: the options are checked', () => {
  const primary = fakeTransport();
  assert.throws(() => new TeeTransport(primary, {}), /mirrors must be a non-empty array/);
  assert.throws(() => new TeeTransport(primary, { mirrors: [] }), /non-empty/);
  assert.throws(() => new TeeTransport(primary, { mirrors: [{}] }), /with a send method/);
  assert.throws(() => new TeeTransport(primary, { mirrors: [primary], timeout: 0 }), /timeout/);
  assert.throws(
    () => new TeeTransport(primary, { mirrors: [primary], awaitMirrors: 'yes' }),
    /awaitMirrors/,
  );
  assert.throws(
    () => new TeeTransport(primary, { mirrors: [primary], maxPending: 0 }),
    /maxPending/,
  );
  const tee = new TeeTransport(primary, { mirrors: [primary] });
  assert.strictEqual(tee.id, 'fake');
  assert.strictEqual(tee.config.timeout, 10000);
  assert.strictEqual(tee.config.awaitMirrors, false);
  assert.strictEqual(tee.config.maxPending, 100);
});

test('Tee: a mirror that ignores its signal fails at its timeout all the same', async () => {
  // Before: the timeout reached a mirror only through its signal, so one that
  // ignored it held a slot of maxPending for ever.
  const deaf = fakeTransport(() => new Promise(() => {}));
  const outcomes = [];
  const tee = new TeeTransport(fakeTransport(), {
    mirrors: [deaf],
    timeout: 20,
    maxPending: 1,
    onMirror: (outcome) => outcomes.push(outcome),
  });
  await tee.send(message('one'));
  await waitFor(() => outcomes.length === 1);
  assert.match(outcomes[0].error.message, /did not answer within 20 ms/);
  // The slot is free again: the next copy is sent, not skipped.
  await tee.send(message('two'));
  await waitFor(() => outcomes.length === 2);
  assert.strictEqual(outcomes[1].skipped, undefined);
});

test('Tee: dispose waits for the copies in flight before disposing of the mirrors', async () => {
  // Before: the mirrors were disposed of while their copies were being sent.
  const order = [];
  const slow = fakeTransport(
    () =>
      new Promise((resolve) =>
        setTimeout(() => {
          order.push('copied');
          resolve(sent('m'));
        }, 30),
      ),
    {
      overrides: {
        async [Symbol.asyncDispose]() {
          order.push('disposed');
        },
      },
    },
  );
  const tee = new TeeTransport(fakeTransport(), { mirrors: [slow], onMirror: () => {} });
  await tee.send(message());
  await tee[Symbol.asyncDispose]();
  assert.deepStrictEqual(order, ['copied', 'disposed']);
});

test('Tee: the primary and the mirrors send one Message-ID', async () => {
  // Before: each composed its own, so a copy could not be told for the message.
  const primary = fakeTransport();
  const mirror = fakeTransport();
  const tee = new TeeTransport(primary, { mirrors: [mirror], awaitMirrors: true });
  await tee.send(message());
  await collect(tee.sendMany([message('b')]));
  for (let i = 0; i < 2; i++) {
    const id = primary.calls[i].message.messageId;
    assert.match(id, /^[^<>]+@example\.com$/);
    assert.strictEqual(mirror.calls[i].message.messageId, id);
  }
});

test('Tee: a failed copy is a warning with no address, and a flood of them is cut', async (t) => {
  // Before: the first error text of the receipt went out as it was, the
  // recipient of an SMTP rejection in it, once for every message.
  // An hour on, past the minute of the warnings of the tests before.
  let time = performance.now() + 60 * 60 * 1000;
  t.mock.method(performance, 'now', () => time);
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text, options) => warnings.push([text, options.code]));
  const rejecting = fakeTransport(() => ({
    ...failed('rejected'),
    errorMessages: ['550 5.1.1 <bob@example.com>: Recipient address rejected'],
  }));
  const tee = new TeeTransport(fakeTransport(), { mirrors: [rejecting], awaitMirrors: true });
  for (let i = 0; i < 12; i++) await tee.send(message());
  assert.strictEqual(warnings.length, 10);
  assert.ok(!warnings[0][0].includes('bob@example.com'), warnings[0][0]);
  assert.match(warnings[0][0], /The mirror fake failed: 550 5\.1\.1/);
  time += 60 * 1000;
  await tee.send(message());
  assert.strictEqual(warnings.length, 11);
  assert.match(warnings[10][0], /2 more warnings of MAILER_TEE_MIRROR_FAILED were left out/);
});

test('Tee: the mirrors start once the primary has answered, and not when it throws', async () => {
  // Before: the copies started before the primary's send, so a mirror could
  // run ahead of the provider in use.
  const order = [];
  const primary = fakeTransport(async (m) => {
    order.push(`primary ${m.subject}`);
    await settle();
    order.push(`answered ${m.subject}`);
    return sent('p');
  });
  const mirror = fakeTransport((m) => {
    order.push(`mirror ${m.subject}`);
    return sent('m');
  });
  const tee = new TeeTransport(primary, { mirrors: [mirror], awaitMirrors: true });
  await tee.send(message('one'));
  await collect(tee.sendMany([message('two')]));
  assert.deepStrictEqual(order, [
    'primary one',
    'answered one',
    'mirror one',
    'primary two',
    'answered two',
    'mirror two',
  ]);
  const throwing = new TeeTransport(
    fakeTransport(() => {
      throw new Error('bug');
    }),
    { mirrors: [mirror], awaitMirrors: true },
  );
  order.length = 0;
  await assert.rejects(throwing.send(message('three')), /bug/);
  assert.deepStrictEqual(order, []);
});
