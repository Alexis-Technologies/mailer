// Not ported: tests of ./idempotency, ported from unemail's idempotency
// middleware, against a fake transport.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { CircuitBreakerTransport } = require('../../src/breaker/index.js');
const {
  IdempotencyTransport,
  createMemoryIdempotencyStore,
} = require('../../src/idempotency/index.js');
const { collect, failed, fakeTransport, sent } = require('../helpers/decorators/fake.js');

const message = (fields = {}) =>
  createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'Welcome',
    content: { text: 'x' },
    ...fields,
  });

const deferred = () => {
  let resolve;
  const promise = new Promise((_resolve) => {
    resolve = _resolve;
  });
  return { promise, resolve };
};

test('Idempotency: a key is sent once, then answered with its receipt', async () => {
  const inner = fakeTransport();
  const once = new IdempotencyTransport(inner);
  const first = await once.send(message({ idempotencyKey: 'welcome:1' }));
  const second = await once.send(message({ idempotencyKey: 'welcome:1' }));
  assert.strictEqual(first.messageId, 'm0');
  assert.deepStrictEqual(second, first);
  assert.strictEqual(inner.calls.length, 1);
  // Without a key, a message goes every time.
  await once.send(message());
  await once.send(message());
  assert.strictEqual(inner.calls.length, 3);
});

test('Idempotency: a send under a key in flight is not sent again', async () => {
  const gate = deferred();
  const inner = fakeTransport(() => gate.promise);
  const once = new IdempotencyTransport(inner);
  const first = once.send(message({ idempotencyKey: 'k' }));
  // Changed in the port: unemail looked the key up before the send and wrote
  // it after, so this one went too.
  const second = await once.send(message({ idempotencyKey: 'k' }));
  assert.strictEqual(second.successful, false);
  assert.strictEqual(second.deliveryUnknown, true);
  assert.strictEqual(second.errors[0].code, 'idempotency.in_flight');
  gate.resolve(sent('only'));
  assert.strictEqual((await first).messageId, 'only');
  assert.strictEqual(inner.calls.length, 1);
});

test('Idempotency: a key used for another message is refused', async () => {
  const inner = fakeTransport();
  const once = new IdempotencyTransport(inner);
  await once.send(message({ idempotencyKey: 'k' }));
  // Changed in the port: unemail answered with the receipt of the first.
  const other = await once.send(message({ idempotencyKey: 'k', subject: 'Another' }));
  assert.strictEqual(other.errors[0].code, 'idempotency.key_reused');
  assert.strictEqual(other.errors[0].category, 'validation');
  assert.strictEqual(other.retryable, false);
  // A pinned Message-ID or Date is not part of the message's fingerprint.
  const again = await once.send(
    message({ idempotencyKey: 'k', messageId: '<x@example.com>', date: new Date(0) }),
  );
  assert.strictEqual(again.messageId, 'm0');
  for (const fields of [
    { to: 'c@example.com' },
    { headers: { 'X-Campaign': 'b' } },
    { metadata: { order: '2' } },
    {
      attachments: {
        filename: 'r.txt',
        contentType: 'text/plain',
        inline: false,
        contentId: '',
        content: new Uint8Array(1),
      },
    },
    { scheduledAt: new Date(1) },
  ]) {
    const refused = await once.send(message({ idempotencyKey: 'k', ...fields }));
    assert.strictEqual(refused.errors[0].code, 'idempotency.key_reused', JSON.stringify(fields));
  }
  assert.strictEqual(inner.calls.length, 1);
});

test('Idempotency: a failure frees the key, an unknown delivery keeps it', async () => {
  const answers = [
    failed('validation', { retryable: false }),
    sent('second'),
    failed('timeout', { deliveryUnknown: true, retryable: false }),
  ];
  const inner = fakeTransport((_m, index) => answers[index]);
  const once = new IdempotencyTransport(inner);
  assert.strictEqual((await once.send(message({ idempotencyKey: 'a' }))).successful, false);
  assert.strictEqual((await once.send(message({ idempotencyKey: 'a' }))).messageId, 'second');
  const unknown = await once.send(message({ idempotencyKey: 'b' }));
  // Changed in the port: unemail remembered successes only, so a retry went again.
  const replay = await once.send(message({ idempotencyKey: 'b' }));
  assert.deepStrictEqual(replay, unknown);
  assert.strictEqual(inner.calls.length, 3);
});

test('Idempotency: an abort keeps the key as of unknown delivery, another throw frees it', async () => {
  const answers = [];
  const started = deferred();
  const inner = fakeTransport((_m, index, options) => {
    if (answers[index] !== undefined) return answers[index];
    started.resolve();
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    });
  });
  const once = new IdempotencyTransport(inner);
  const controller = new AbortController();
  const aborted = once.send(message({ idempotencyKey: 'a' }), { signal: controller.signal });
  await started.promise;
  controller.abort(new Error('left'));
  await assert.rejects(aborted, /left/);
  const after = await once.send(message({ idempotencyKey: 'a' }));
  assert.strictEqual(after.deliveryUnknown, true);
  assert.strictEqual(after.errors[0].code, 'idempotency.aborted');
  answers[1] = { throw: new TypeError('bug') };
  answers[2] = sent('fixed');
  await assert.rejects(once.send(message({ idempotencyKey: 'b' })), /bug/);
  assert.strictEqual((await once.send(message({ idempotencyKey: 'b' }))).messageId, 'fixed');
  await assert.rejects(
    once.send(message(), { signal: AbortSignal.abort(new Error('already')) }),
    /already/,
  );
  // Aborted after the key is reserved and before the send begins: the key is
  // free again, as nothing went.
  const early = new AbortController();
  const slow = new IdempotencyTransport(inner, {
    store: {
      ...createMemoryIdempotencyStore(),
      reserve: async () => {
        early.abort(new Error('changed my mind'));
        return { token: 't' };
      },
      release: () => {},
    },
  });
  await assert.rejects(
    slow.send(message({ idempotencyKey: 'c' }), { signal: early.signal }),
    /changed my mind/,
  );
  assert.strictEqual(inner.calls.length, 3);
});

test('Idempotency: a store that fails fails its message alone, or becomes a warning', async (t) => {
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text, options) => warnings.push([text, options.code]));
  const memory = createMemoryIdempotencyStore();
  let failing = 'reserve';
  const store = {
    reserve: (...args) => {
      if (failing === 'reserve') throw new Error('store down');
      return memory.reserve(...args);
    },
    complete: async (...args) => {
      if (failing === 'complete') throw new Error('cannot write');
      return memory.complete(...args);
    },
    release: (...args) => {
      // oxlint-disable-next-line no-throw-literal -- a store may throw anything
      if (failing === 'release') throw 'cannot delete';
      return memory.release(...args);
    },
  };
  const answers = [
    sent('one'),
    failed('validation', { retryable: false }),
    { throw: new Error('bug') },
  ];
  const inner = fakeTransport((_m, index) => answers[index]);
  const once = new IdempotencyTransport(inner, { store });
  const down = await once.send(message({ idempotencyKey: 'a' }));
  assert.strictEqual(down.errors[0].code, 'idempotency.store_failed');
  assert.strictEqual(down.retryable, true);
  assert.strictEqual(inner.calls.length, 0);
  failing = 'complete';
  assert.strictEqual((await once.send(message({ idempotencyKey: 'a' }))).messageId, 'one');
  failing = 'release';
  assert.strictEqual((await once.send(message({ idempotencyKey: 'b' }))).successful, false);
  await assert.rejects(once.send(message({ idempotencyKey: 'c' })), /bug/);
  assert.deepStrictEqual(warnings, [
    ['The idempotency store threw: cannot write', 'MAILER_IDEMPOTENCY_STORE_FAILED'],
    ['The idempotency store threw: cannot delete', 'MAILER_IDEMPOTENCY_STORE_FAILED'],
    ['The idempotency store threw: cannot delete', 'MAILER_IDEMPOTENCY_STORE_FAILED'],
  ]);
});

test('Idempotency: a reserved key is free again after leaseMs, a receipt kept for ttlMs', async () => {
  let time = 0;
  const store = createMemoryIdempotencyStore({ now: () => time });
  const hung = deferred();
  const inner = fakeTransport((_m, index) => (index === 0 ? hung.promise : sent(`m${index}`)));
  const once = new IdempotencyTransport(inner, { store, leaseMs: 1000, ttlMs: 5000 });
  // The first send does not settle, as after a crash: its key stays reserved
  // for its lease, not for the day a receipt is kept.
  const first = once.send(message({ idempotencyKey: 'k' }));
  time = 999;
  const during = await once.send(message({ idempotencyKey: 'k' }));
  assert.strictEqual(during.errors[0].code, 'idempotency.in_flight');
  time = 1000;
  assert.strictEqual((await once.send(message({ idempotencyKey: 'k' }))).messageId, 'm1');
  time = 5999;
  assert.strictEqual((await once.send(message({ idempotencyKey: 'k' }))).messageId, 'm1');
  // The first ends at last, failed: its release does not free the receipt of
  // the send that took its key.
  hung.resolve(failed('validation', { retryable: false }));
  assert.strictEqual((await first).successful, false);
  assert.strictEqual((await once.send(message({ idempotencyKey: 'k' }))).messageId, 'm1');
  time = 6000;
  assert.strictEqual((await once.send(message({ idempotencyKey: 'k' }))).messageId, 'm2');
  assert.strictEqual(inner.calls.length, 3);
});

test('Idempotency: a send that outlived its lease leaves the new owner of its key alone', async () => {
  let time = 0;
  const store = createMemoryIdempotencyStore({ now: () => time });
  const slow = deferred();
  const owner = deferred();
  const gates = [slow, owner];
  const inner = fakeTransport((_m, index) => gates[index]?.promise ?? sent(`m${index}`));
  const once = new IdempotencyTransport(inner, { store, leaseMs: 1000 });
  const late = once.send(message({ idempotencyKey: 'k' }));
  time = 1000;
  const taken = once.send(message({ idempotencyKey: 'k' }));
  // Slow rather than gone, the first completes under its old token.
  slow.resolve(sent('late'));
  assert.strictEqual((await late).messageId, 'late');
  const during = await once.send(message({ idempotencyKey: 'k' }));
  assert.strictEqual(during.errors[0].code, 'idempotency.in_flight');
  // The owner's failure frees the key for the next send.
  owner.resolve(failed('validation', { retryable: false }));
  assert.strictEqual((await taken).successful, false);
  assert.strictEqual((await once.send(message({ idempotencyKey: 'k' }))).messageId, 'm2');
  assert.strictEqual(inner.calls.length, 3);
});

test('Idempotency: its receipts carry their own category, not one the words of a key suggest', async () => {
  const gate = deferred();
  const inner = fakeTransport(() => gate.promise);
  const once = new IdempotencyTransport(inner);
  const breaker = new CircuitBreakerTransport(once, { failureThreshold: 1 });
  const first = once.send(message({ idempotencyKey: 'order-timeout-1' }));
  const inFlight = await breaker.send(message({ idempotencyKey: 'order-timeout-1' }));
  assert.strictEqual(inFlight.errors[0].code, 'idempotency.in_flight');
  assert.strictEqual(inFlight.errors[0].category, 'unknown');
  assert.strictEqual(inFlight.deliveryUnknown, true);
  assert.strictEqual(inFlight.retryable, false);
  gate.resolve(sent('m'));
  await first;
  const controller = new AbortController();
  const started = deferred();
  const stuck = fakeTransport((_m, _index, options) => {
    started.resolve();
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    });
  });
  const abortable = new IdempotencyTransport(stuck);
  const aborted = abortable.send(message({ idempotencyKey: 'timeout' }), {
    signal: controller.signal,
  });
  await started.promise;
  controller.abort(new Error('left'));
  await assert.rejects(aborted, /left/);
  const after = await abortable.send(message({ idempotencyKey: 'timeout' }));
  assert.strictEqual(after.errors[0].code, 'idempotency.aborted');
  assert.strictEqual(after.errors[0].category, 'unknown');
  assert.strictEqual(after.deliveryUnknown, true);
  // A store that fails is retried, but is not the provider failing.
  const down = new IdempotencyTransport(inner, {
    store: {
      reserve: () => {
        throw new Error('connection timeout');
      },
      complete() {},
      release() {},
    },
  });
  const guarded = new CircuitBreakerTransport(down, { failureThreshold: 1 });
  const failure = await guarded.send(message({ idempotencyKey: 'k' }));
  assert.strictEqual(failure.errors[0].code, 'idempotency.store_failed');
  assert.strictEqual(failure.errors[0].category, 'unknown');
  assert.strictEqual(failure.errors[0].retryable, true);
  assert.strictEqual(failure.retryable, true);
  assert.strictEqual(breaker.state, 'closed');
  assert.strictEqual(guarded.state, 'closed');
});

test('Idempotency: a reserve that answers neither or both of token and record fails its message', async () => {
  const inner = fakeTransport();
  for (const answer of [
    undefined,
    null,
    {},
    { token: '' },
    { record: null },
    { token: 't', record: { state: 'done', fingerprint: 'f' } },
  ]) {
    const store = { reserve: async () => answer, complete() {}, release() {} };
    const receipt = await new IdempotencyTransport(inner, { store }).send(
      message({ idempotencyKey: 'k' }),
    );
    assert.strictEqual(receipt.errors[0].code, 'idempotency.store_failed', String(answer));
    assert.match(receipt.errorMessages[0], /reserve must resolve to \{ token \} or \{ record \}/);
  }
  assert.strictEqual(inner.calls.length, 0);
});

test('Idempotency: sendMany answers repeated keys in place, the batch too', async () => {
  const inner = fakeTransport(undefined, { readAhead: 1 });
  const once = new IdempotencyTransport(inner);
  await once.send(message({ idempotencyKey: 'before' }));
  const receipts = await collect(
    once.sendMany([
      message({ idempotencyKey: 'x' }),
      message({ idempotencyKey: 'before' }),
      message({ idempotencyKey: 'x' }),
      message(),
    ]),
  );
  // The second x comes once the first is done, and gets its receipt.
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.messageId ?? receipt.errors[0].code),
    ['m1', 'm0', 'm1', 'm2'],
  );
  // Read while the first is in flight, a second y is not sent.
  const twice = await collect(
    once.sendMany([message({ idempotencyKey: 'y' }), message({ idempotencyKey: 'y' })]),
  );
  assert.deepStrictEqual(
    twice.map((receipt) => receipt.messageId ?? receipt.errors[0].code),
    ['m3', 'idempotency.in_flight'],
  );
  assert.strictEqual((await once.send(message({ idempotencyKey: 'x' }))).messageId, 'm1');
  const exploding = fakeTransport(undefined, {
    overrides: {
      // oxlint-disable-next-line require-yield
      async *sendMany(messages) {
        await messages[Symbol.asyncIterator]().next();
        throw new Error('batch exploded');
      },
    },
  });
  const guarded = new IdempotencyTransport(exploding);
  await assert.rejects(
    collect(guarded.sendMany([message({ idempotencyKey: 'y' })])),
    /batch exploded/,
  );
  // The key of the message that threw is free again.
  assert.strictEqual((await guarded.send(message({ idempotencyKey: 'y' }))).messageId, 'm0');
});

test('Idempotency: a key function, a namespace, sendRaw, verify and dispose', async () => {
  const store = createMemoryIdempotencyStore();
  const inner = fakeTransport();
  const keyOf = (m) => m.envelope?.to[0] ?? m.metadata?.order;
  const a = new IdempotencyTransport(inner, { store, key: keyOf, namespace: 'tenant-a' });
  const b = new IdempotencyTransport(inner, { store, key: keyOf, namespace: 'tenant-b' });
  await a.send(message({ metadata: { order: '1' } }));
  await a.send(message({ metadata: { order: '1' } }));
  await b.send(message({ metadata: { order: '1' } }));
  assert.strictEqual(inner.calls.length, 2);
  const raw = { envelope: { from: 'a@example.com', to: ['b@example.com'] }, content: 'x' };
  await a.sendRaw(raw);
  await a.sendRaw(raw);
  assert.strictEqual(inner.calls.length, 3);
  const otherRaw = { envelope: { from: 'c@example.com', to: ['b@example.com'] }, content: 'x' };
  assert.strictEqual((await a.sendRaw(otherRaw)).errors[0].code, 'idempotency.key_reused');
  await a.verify();
  assert.strictEqual(inner.verified, 1);
  await a[Symbol.asyncDispose]();
  assert.strictEqual(inner.disposed, 1);
  const plain = { id: 'plain', send: async () => sent('p') };
  const bare = new IdempotencyTransport(plain);
  assert.strictEqual((await bare.sendRaw(raw)).errors[0].category, 'configuration');
  await bare.verify();
  await bare[Symbol.asyncDispose]();
  let disposed = 0;
  await new IdempotencyTransport({ ...plain, [Symbol.dispose]: () => disposed++ })[
    Symbol.asyncDispose
  ]();
  assert.strictEqual(disposed, 1);
  assert.throws(() => new IdempotencyTransport(inner, { store: {} }), /store must have a reserve/);
  assert.throws(() => new IdempotencyTransport(inner, { ttlMs: 0 }), /ttlMs/);
  assert.throws(() => new IdempotencyTransport(inner, { leaseMs: Infinity }), /leaseMs/);
  assert.throws(() => new IdempotencyTransport(inner, { namespace: 1 }), /namespace/);
  const defaults = new IdempotencyTransport(inner).config;
  assert.strictEqual(defaults.namespace, 'fake');
  assert.strictEqual(defaults.leaseMs, 10 * 60 * 1000);
  assert.strictEqual(defaults.ttlMs, 24 * 60 * 60 * 1000);
});

test('Idempotency: the memory store reserves under a token, for a lease, then a time', () => {
  let time = 0;
  const store = createMemoryIdempotencyStore({ now: () => time });
  const { token } = store.reserve('a', 'fa', 100);
  assert.match(token, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepStrictEqual(store.reserve('a', 'fa', 100), {
    record: { state: 'pending', fingerprint: 'fa' },
  });
  store.complete('a', token, { fingerprint: 'fa', receipt: sent('ra') }, 1000);
  // Kept for its time, not for the lease of its reservation.
  time = 999;
  assert.deepStrictEqual(store.reserve('a', 'fa', 100), {
    record: { state: 'done', fingerprint: 'fa', receipt: sent('ra') },
  });
  time = 1000;
  const again = store.reserve('a', 'fa', 100);
  assert.notStrictEqual(again.token, token);
  store.release('a', again.token);
  assert.notStrictEqual(store.reserve('a', 'fa', 100).token, undefined);
  // A key whose lease passed and that no one took is still completed.
  time = 2000;
  store.complete('b', 'unknown', { fingerprint: 'fb', receipt: sent('rb') }, 1000);
  assert.strictEqual(store.reserve('b', 'fb', 100).record.receipt.messageId, 'rb');
  assert.throws(() => createMemoryIdempotencyStore({ maxEntries: 0 }), /maxEntries/);
});

test('Idempotency: a late complete or release under a stale token leaves the key alone', () => {
  let time = 0;
  const store = createMemoryIdempotencyStore({ now: () => time });
  const stale = store.reserve('k', 'f', 100).token;
  time = 100;
  const owner = store.reserve('k', 'f', 100).token;
  store.complete('k', stale, { fingerprint: 'f', receipt: sent('stale') }, 1000);
  store.release('k', stale);
  assert.deepStrictEqual(store.reserve('k', 'f', 100), {
    record: { state: 'pending', fingerprint: 'f' },
  });
  store.complete('k', owner, { fingerprint: 'f', receipt: sent('owner') }, 1000);
  store.complete('k', stale, { fingerprint: 'f', receipt: sent('stale') }, 1000);
  store.release('k', stale);
  // A done key is not released, by its own token either.
  store.release('k', owner);
  assert.strictEqual(store.reserve('k', 'f', 100).record.receipt.messageId, 'owner');
});

test('Idempotency: the memory store makes room with expired keys, then done ones, never pending', () => {
  let time = 0;
  const store = createMemoryIdempotencyStore({ maxEntries: 2, now: () => time });
  store.reserve('pending', 'fp', 1000);
  const { token } = store.reserve('done', 'fd', 1000);
  store.complete('done', token, { fingerprint: 'fd', receipt: sent('rd') }, 5000);
  // Three keys for two places: the done one goes, though the pending one is
  // older; unemail dropped the pending one, and its message could go twice.
  store.reserve('new', 'fn', 1000);
  const pending = { record: { state: 'pending', fingerprint: 'fp' } };
  assert.deepStrictEqual(store.reserve('pending', 'fp', 1000), pending);
  // While more sends than maxEntries are in flight, it holds every key.
  assert.notStrictEqual(store.reserve('done', 'fd', 1000).token, undefined);
  assert.deepStrictEqual(store.reserve('pending', 'fp', 1000), pending);
  assert.strictEqual(store.reserve('new', 'fn', 1000).record.state, 'pending');
  // Expired keys go before a done one still within its time.
  const kept = createMemoryIdempotencyStore({ maxEntries: 2, now: () => time });
  kept.reserve('old', 'fo', 100);
  const keptToken = kept.reserve('kept', 'fk', 1000).token;
  kept.complete('kept', keptToken, { fingerprint: 'fk', receipt: sent('rk') }, 5000);
  time = 100;
  kept.reserve('third', 'ft', 1000);
  assert.strictEqual(kept.reserve('kept', 'fk', 1000).record.receipt.messageId, 'rk');
});

test('Idempotency: a key a batch left before its answer is held for the lease alone', async () => {
  // Before: the key of a message handed to a transport that reads ahead, and
  // left unanswered on a break, stayed pending, answered in_flight, until it
  // expired.
  let time = 0;
  const store = createMemoryIdempotencyStore({ now: () => time });
  const inner = fakeTransport(undefined, { readAhead: 1 });
  const idempotent = new IdempotencyTransport(inner, { store, leaseMs: 1000 });
  for await (const receipt of idempotent.sendMany([
    message({ idempotencyKey: 'k-1' }),
    message({ idempotencyKey: 'k-2', subject: 'Second' }),
  ])) {
    if (receipt.successful) break;
  }
  const again = await idempotent.send(message({ idempotencyKey: 'k-2', subject: 'Second' }));
  assert.strictEqual(again.successful, false);
  assert.strictEqual(again.errors[0].code, 'idempotency.abandoned');
  assert.strictEqual(again.deliveryUnknown, true);
  time = 1000;
  const later = await idempotent.send(message({ idempotencyKey: 'k-2', subject: 'Second' }));
  assert.strictEqual(later.successful, true);
});
