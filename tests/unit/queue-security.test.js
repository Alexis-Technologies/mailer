// Not ported: tests of what keeps a job of ./queue to what its producer
// enqueued, against whoever can write to the store of the queue.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  MailQueueError,
  createMailJobHandler,
  createMailQueue,
  createMemoryQueue,
  parseMailJob,
  prepareMailJob,
} = require('../../src/queue/index.js');
const { hashJson } = require('../../src/queue/hash.js');
const { UNHASHED } = require('../../src/queue/job.js');
const { fakeTransport } = require('../helpers/decorators/fake.js');
const { manualClock } = require('../helpers/queue/clock.js');

const NOW = Date.parse('2026-10-18T09:00:00Z');
const KEY_A = { id: 'a', secret: 'a'.repeat(32) };
const KEY_B = { id: 'b', secret: new Uint8Array(32).fill(7) };
const input = {
  kind: 'content',
  subject: 'Your code',
  content: { text: 'Your code is 123456' },
  from: 'App <app@example.com>',
  to: 'ada@example.com',
  idempotencyKey: 'code:1',
};
const prepare = (options) => prepareMailJob(input, { now: () => NOW, ...options });
const copyOf = (data) => JSON.parse(JSON.stringify(data));
const isCode = (code) => (error) => error instanceof MailQueueError && error.code === code;

// What a writer to the store can do: change the job and recompute its hash.
const forge = (data) => {
  const forged = copyOf(data);
  forged.to = [{ address: 'victim@example.org' }];
  forged.content = { text: 'Reset your password at https://evil.example' };
  forged.hash = hashJson(forged, UNHASHED);
  return forged;
};

test('Queue: a signed job carries its key id and HMAC, outside its hash', () => {
  const plain = prepare().data;
  const signed = prepare({ signingKeys: [KEY_A] }).data;
  assert.strictEqual(signed.kid, 'a');
  assert.match(signed.mac, /^[0-9a-f]{64}$/);
  assert.strictEqual(signed.hash, plain.hash);
  const copy = copyOf(signed);
  assert.strictEqual(parseMailJob(copy, { signingKeys: [KEY_A] }), copy);
});

test('Queue: a job forged with its hash recomputed is refused under signing keys', () => {
  const signed = prepare({ signingKeys: [KEY_A] }).data;
  const forged = forge(signed);
  // Its SHA-256 alone does not tell it: anyone who writes to the store can make it.
  assert.strictEqual(parseMailJob(forged).to[0].address, 'victim@example.org');
  assert.throws(
    () => parseMailJob(forged, { signingKeys: [KEY_A] }),
    (error) => {
      assert.ok(isCode('queue.signature_invalid')(error));
      assert.match(error.message, /does not verify/);
      return true;
    },
  );
  const unsigned = forge(prepare().data);
  assert.throws(
    () => parseMailJob(unsigned, { signingKeys: [KEY_A] }),
    (error) => isCode('queue.signature_invalid')(error) && /not signed/.test(error.message),
  );
  const badMac = { ...copyOf(signed), mac: 'z'.repeat(64) };
  assert.throws(
    () => parseMailJob(badMac, { signingKeys: [KEY_A] }),
    isCode('queue.signature_invalid'),
  );
});

test('Queue: signing keys rotate: the first signs, each verifies', () => {
  const old = copyOf(prepare({ signingKeys: [KEY_A] }).data);
  const rotated = copyOf(prepare({ signingKeys: [KEY_B, KEY_A] }).data);
  assert.strictEqual(rotated.kid, 'b');
  for (const data of [old, rotated]) {
    assert.strictEqual(parseMailJob(data, { signingKeys: [KEY_B, KEY_A] }), data);
  }
  // Once the old key is dropped, what it signed is refused.
  assert.throws(
    () => parseMailJob(old, { signingKeys: [KEY_B] }),
    (error) => isCode('queue.signature_invalid')(error) && /"a"/.test(error.message),
  );
});

test('Queue: signing keys are checked', () => {
  const refusals = [
    [[], /non-empty array/],
    ['key', /non-empty array/],
    [[{ id: 'a', secret: 'short' }], /32 bytes/],
    [[{ id: 'a b', secret: KEY_A.secret }], /id of a signing key/],
    [[{ id: 'a', secret: 42 }], /32 bytes/],
    [[KEY_A, { ...KEY_A }], /given twice/],
  ];
  for (const [signingKeys, pattern] of refusals) {
    assert.throws(() => prepare({ signingKeys }), pattern);
    assert.throws(() => createMailJobHandler({ transport: fakeTransport(), signingKeys }), pattern);
    assert.throws(() => createMailQueue({ driver: createMemoryQueue(), signingKeys }), pattern);
  }
});

test('Queue: a worker with signing keys sends a signed job and fails a forged one unsent', async () => {
  const clock = manualClock(NOW);
  const driver = createMemoryQueue({ now: clock.now, sleep: clock.sleep });
  const queue = createMailQueue({ driver, now: clock.now, signingKeys: [KEY_A] });
  const transport = fakeTransport();
  await queue.enqueue(input);
  await using worker = queue.createWorker({ transport });
  await driver.drain();
  assert.strictEqual(transport.calls.length, 1);
  assert.ok(worker);

  const records = [];
  const logger = { error: (record, message) => records.push([message, record]) };
  const handler = createMailJobHandler({ transport, signingKeys: [KEY_A], logger, now: () => NOW });
  const signed = prepare({ signingKeys: [KEY_A] });
  const job = {
    id: signed.request.id,
    name: 'mail',
    data: forge(signed.data),
    attempt: 1,
    maxAttempts: 5,
    redelivered: false,
  };
  const outcome = await handler(job, new AbortController().signal);
  assert.deepStrictEqual([outcome.type, outcome.code], ['fail', 'queue.signature_invalid']);
  assert.strictEqual(transport.calls.length, 1);
  assert.deepStrictEqual(records[0][0], 'queue.job.failed');
  assert.strictEqual(records[0][1].code, 'queue.signature_invalid');
});
