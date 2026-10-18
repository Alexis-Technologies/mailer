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

// An envelope encryption as an application would write it: AES-256-GCM.
const aesCodec = (key = Buffer.alloc(32, 9)) => {
  const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
  return {
    encode(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const sealed = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64');
    },
    async decode(text) {
      const bytes = Buffer.from(text, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString();
    },
  };
};

const runOf = (data, extra = {}) => ({
  id: 'job-1',
  name: 'mail',
  data,
  attempt: 1,
  maxAttempts: 5,
  redelivered: false,
  ...extra,
});

test('Queue: with a codec the store holds no address, and the worker opens the job', async () => {
  const clock = manualClock(NOW);
  const driver = createMemoryQueue({ now: clock.now, sleep: clock.sleep });
  const codec = aesCodec();
  const queue = createMailQueue({ driver, now: clock.now, codec, signingKeys: [KEY_A] });
  const transport = fakeTransport();
  const withFile = {
    ...input,
    attachments: [{ filename: 'a.txt', content: new Uint8Array([65]) }],
  };
  const enqueued = await queue.enqueue(withFile);
  const [stored] = driver.list();
  assert.deepStrictEqual(Object.keys(stored.data).toSorted(), [
    'enc',
    'enqueuedAt',
    'hash',
    'kid',
    'mac',
    'v',
  ]);
  const text = JSON.stringify(stored);
  for (const secret of ['ada@example.com', 'app@example.com', '123456', 'a.txt']) {
    assert.ok(!text.includes(secret), secret);
  }
  // A duplicate is still told by the hash in clear.
  assert.strictEqual((await queue.enqueue(withFile)).duplicate, true);
  await using worker = queue.createWorker({ transport });
  await driver.drain();
  assert.strictEqual(transport.calls.length, 1);
  const { message } = transport.calls[0];
  assert.strictEqual(message.recipients[0].address, 'ada@example.com');
  assert.strictEqual(message.messageId, enqueued.messageId);
  assert.ok(worker);
  assert.throws(() => parseMailJob(stored.data), isCode('queue.codec_missing'));
});

test('Queue: a sealed job waits for a worker with its codec, and fails one that does not open', async () => {
  const codec = aesCodec();
  const queue = createMailQueue({ driver: createMemoryQueue(), codec });
  await queue.enqueue(input);
  const sealed = queue.driver.list()[0].data;
  const transport = fakeTransport();
  const plain = createMailJobHandler({ transport, now: () => NOW });
  const waiting = await plain(runOf(sealed), new AbortController().signal);
  assert.deepStrictEqual([waiting.type, waiting.code], ['retry', 'queue.codec_missing']);
  const last = await plain(runOf(sealed, { attempt: 5 }), new AbortController().signal);
  assert.deepStrictEqual([last.type, last.code], ['fail', 'queue.codec_missing']);
  // Another key: the ciphertext does not authenticate, which may be an outage of the key...
  const other = createMailJobHandler({ transport, codec: aesCodec(Buffer.alloc(32, 1)) });
  const outage = await other(runOf(sealed), new AbortController().signal);
  assert.deepStrictEqual([outage.type, outage.code], ['retry', 'queue.codec_failed']);
  // ...unless the codec says it is for good.
  const final = createMailJobHandler({
    transport,
    codec: {
      encode: (text) => text,
      decode() {
        throw Object.assign(new Error('bad tag'), { retryable: false });
      },
    },
  });
  const refused = await final(runOf(sealed), new AbortController().signal);
  assert.deepStrictEqual([refused.type, refused.code], ['fail', 'queue.codec_failed']);
  assert.strictEqual(transport.calls.length, 0);
});

test('Queue: what a codec opens is checked, and a field in clear is refused', async () => {
  const identity = { encode: (text) => text, decode: (text) => text };
  const handler = createMailJobHandler({ transport: fakeTransport(), codec: identity });
  const outcomeOf = async (data) => (await handler(runOf(data), new AbortController().signal)).code;
  const envelope = { v: 1, hash: 'h', enqueuedAt: '2026-10-18T09:00:00.000Z' };
  assert.strictEqual(await outcomeOf({ ...envelope, enc: 'not json' }), 'queue.invalid_job');
  assert.strictEqual(await outcomeOf({ ...envelope, enc: '[1]' }), 'queue.invalid_job');
  assert.strictEqual(await outcomeOf({ ...envelope, enc: '{"hash":"x"}' }), 'queue.invalid_job');
  const queue = createMailQueue({ driver: createMemoryQueue(), codec: identity });
  await queue.enqueue(input);
  const sealed = queue.driver.list()[0].data;
  const overridden = { ...sealed, to: [{ address: 'victim@example.org' }] };
  assert.strictEqual(await outcomeOf(overridden), 'queue.invalid_job');
  // A writer who can seal (a codec without a key) is still stopped by the signature.
  const signedQueue = createMailQueue({
    driver: createMemoryQueue(),
    codec: identity,
    signingKeys: [KEY_A],
  });
  await signedQueue.enqueue(input);
  const signed = signedQueue.driver.list()[0].data;
  const opened = { ...JSON.parse(signed.enc), ...signed };
  delete opened.enc;
  const forged = forge(opened);
  const { v, hash, enqueuedAt, kid, mac, ...fields } = forged;
  const resealed = { v, hash, enqueuedAt, kid, mac, enc: JSON.stringify(fields) };
  const verifying = createMailJobHandler({
    transport: fakeTransport(),
    codec: identity,
    signingKeys: [KEY_A],
  });
  const outcome = await verifying(runOf(resealed), new AbortController().signal);
  assert.strictEqual(outcome.code, 'queue.signature_invalid');
});

test('Queue: a codec is checked, and must give a string', async () => {
  assert.throws(() => createMailQueue({ driver: createMemoryQueue(), codec: {} }), /codec must/);
  assert.throws(
    () => createMailJobHandler({ transport: fakeTransport(), codec: { encode() {} } }),
    /codec must/,
  );
  const queue = createMailQueue({
    driver: createMemoryQueue(),
    codec: { encode: () => 42, decode: (text) => text },
  });
  await assert.rejects(queue.enqueue(input), /codec.encode must give a string/);
  assert.strictEqual(queue.driver.list().length, 0);
});

test('Queue: under idSecret the id of a job cannot be found from the addresses one knows', () => {
  const { toUuid } = require('../../src/internal/uuid.js');
  const keyed = { ...input, idempotencyKey: 'welcome:ada@example.com' };
  const guess = toUuid('mail\u0000\u0000welcome:ada@example.com');
  // Without a secret the id is a hash anyone can recompute from a guess.
  assert.strictEqual(prepareMailJob(keyed).request.id, guess);
  const secret = 's'.repeat(32);
  const first = prepareMailJob(keyed, { idSecret: secret });
  const again = prepareMailJob(keyed, { idSecret: Buffer.from(secret) });
  assert.notStrictEqual(first.request.id, guess);
  assert.match(
    first.request.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  // The same key and secret: the same job, its Message-ID too.
  assert.strictEqual(again.request.id, first.request.id);
  assert.strictEqual(again.data.messageId, first.data.messageId);
  assert.notStrictEqual(
    prepareMailJob(keyed, { idSecret: 't'.repeat(32) }).request.id,
    first.request.id,
  );
  for (const idSecret of ['short', 42, new Uint8Array(8)]) {
    assert.throws(() => prepareMailJob(keyed, { idSecret }), /idSecret must hold 32 bytes/);
    assert.throws(
      () => createMailQueue({ driver: createMemoryQueue(), idSecret }),
      /idSecret must hold 32 bytes/,
    );
  }
});
