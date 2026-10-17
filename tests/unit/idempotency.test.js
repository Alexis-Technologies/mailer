// Not ported: tests of ./idempotency, ported from unemail's idempotency
// middleware, against a fake transport.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
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
        return undefined;
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
    release: (key) => {
      // oxlint-disable-next-line no-throw-literal -- a store may throw anything
      if (failing === 'release') throw 'cannot delete';
      return memory.release(key);
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
  assert.throws(() => new IdempotencyTransport(inner, { namespace: 1 }), /namespace/);
  assert.strictEqual(new IdempotencyTransport(inner).config.namespace, 'fake');
});

test('Idempotency: the memory store forgets a key after its time, and the oldest first', () => {
  let time = 0;
  const store = createMemoryIdempotencyStore({ maxEntries: 2, now: () => time });
  assert.strictEqual(store.reserve('a', 'fa', 100), undefined);
  assert.deepStrictEqual(store.reserve('a', 'fa', 100), {
    state: 'pending',
    fingerprint: 'fa',
    receipt: undefined,
  });
  store.complete('a', { fingerprint: 'fa', receipt: sent('ra') }, 100);
  assert.strictEqual(store.reserve('a', 'fa', 100).receipt.messageId, 'ra');
  time = 100;
  assert.strictEqual(store.reserve('a', 'fa', 100), undefined);
  store.reserve('b', 'fb', 1000);
  store.reserve('c', 'fc', 1000);
  // Three keys for two places: the oldest, a, goes.
  assert.strictEqual(store.reserve('a', 'fa', 100), undefined);
  assert.notStrictEqual(store.reserve('c', 'fc', 1000), undefined);
  store.release('c');
  assert.strictEqual(store.reserve('c', 'fc', 1000), undefined);
  assert.throws(() => createMemoryIdempotencyStore({ maxEntries: 0 }), /maxEntries/);
});
