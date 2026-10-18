// Not ported: the contract of a QueueSource, one set of cases every source
// that lends its jobs is held to (the memory queue, the MongoDB outbox on a
// fake collection and on MongoDB itself), so that their semantics stay one:
// the order of priorities, leases, redelivery, fencing, releases that spend
// no attempt, and the pause.
const { test } = require('node:test');
const assert = require('node:assert');

const START = Date.parse('2026-10-18T09:00:00Z');
const LEASE = 60_000;

const requestOf = (id, extra = {}) => ({
  id,
  name: 'mail',
  data: { v: 1, id },
  hash: `hash-${id}`,
  priority: 'normal',
  maxAttempts: 5,
  enqueuedAt: START,
  ...extra,
});

/**
 * Registers the cases of the contract for a source.
 *
 * @param name The name of the source, in the names of the tests.
 * @param makeSource `({ now }) => Promise<{ source, cleanup? }>`: a new, empty
 * source on the clock given.
 * @param options `skip`, to register the cases skipped.
 */
const sourceContract = (name, makeSource, options = {}) => {
  const contract = (title, body) =>
    test(`Queue source (${name}): ${title}`, { skip: options.skip }, async (t) => {
      let time = START;
      const clock = {
        now: () => time,
        advance(milliseconds) {
          time += milliseconds;
        },
      };
      const made = await makeSource({ now: clock.now });
      if (made.cleanup !== undefined) t.after(made.cleanup);
      await body(made.source, clock);
    });

  contract('a job is lent once, its first attempt, its data a copy', async (source) => {
    const request = requestOf('a');
    assert.deepStrictEqual(await source.enqueue(request), { id: 'a', duplicate: false });
    const { lease } = await source.reserve(LEASE);
    assert.strictEqual(lease.job.id, 'a');
    assert.strictEqual(lease.job.name, 'mail');
    assert.deepStrictEqual(lease.job.data, request.data);
    assert.notStrictEqual(lease.job.data, request.data);
    assert.strictEqual(lease.job.attempt, 1);
    assert.strictEqual(lease.job.maxAttempts, 5);
    assert.strictEqual(lease.job.redelivered, false);
    assert.strictEqual(typeof lease.token, 'string');
    assert.strictEqual((await source.reserve(LEASE)).lease, undefined);
  });

  contract('an id enqueued again is a duplicate, with the hash it holds', async (source) => {
    await source.enqueue(requestOf('a'));
    const again = await source.enqueue(requestOf('a', { hash: 'other' }));
    assert.deepStrictEqual(again, { id: 'a', duplicate: true, existingHash: 'hash-a' });
  });

  contract('jobs go by priority, then time, then order', async (source) => {
    await source.enqueue(requestOf('low', { priority: 'low' }));
    await source.enqueue(requestOf('n1'));
    await source.enqueue(requestOf('n0', { availableAt: START - 1000 }));
    // Of two due at once, the one enqueued first: a store orders them by time.
    await source.enqueue(requestOf('n2', { enqueuedAt: START + 1, availableAt: START }));
    await source.enqueue(requestOf('high', { priority: 'high' }));
    const order = [];
    for (let index = 0; index < 5; index++) {
      const { lease } = await source.reserve(LEASE);
      order.push(lease.job.id);
      await source.ack(lease, null);
    }
    assert.deepStrictEqual(order, ['high', 'n0', 'n1', 'n2', 'low']);
  });

  contract('a job not yet due tells when it is', async (source, clock) => {
    await source.enqueue(requestOf('later', { availableAt: START + 5000 }));
    assert.deepStrictEqual(await source.reserve(LEASE), { nextAvailableAt: START + 5000 });
    clock.advance(5000);
    assert.strictEqual((await source.reserve(LEASE)).lease.job.id, 'later');
  });

  contract('an acknowledged or failed job does not come back', async (source, clock) => {
    await source.enqueue(requestOf('done'));
    await source.enqueue(requestOf('failed'));
    for (let index = 0; index < 2; index++) {
      const { lease } = await source.reserve(LEASE);
      if (lease.job.id === 'done') await source.ack(lease, { provider: 'p' });
      else await source.fail(lease, { code: 'x', reason: 'y' });
    }
    clock.advance(LEASE * 2);
    assert.strictEqual((await source.reserve(LEASE)).lease, undefined);
  });

  contract('a retry comes back when due, its next attempt', async (source, clock) => {
    await source.enqueue(requestOf('a'));
    const first = (await source.reserve(LEASE)).lease;
    await source.retry(first, START + 1000, { code: 'x', reason: 'y' });
    assert.deepStrictEqual(await source.reserve(LEASE), { nextAvailableAt: START + 1000 });
    clock.advance(1000);
    const second = (await source.reserve(LEASE)).lease;
    assert.strictEqual(second.job.attempt, 2);
    assert.strictEqual(second.job.redelivered, false);
  });

  contract('a release spends no attempt', async (source, clock) => {
    await source.enqueue(requestOf('a'));
    const first = (await source.reserve(LEASE)).lease;
    await source.release(first, START + 500);
    clock.advance(500);
    const again = (await source.reserve(LEASE)).lease;
    assert.strictEqual(again.job.attempt, 1);
    await source.release(again);
    assert.strictEqual((await source.reserve(LEASE)).lease.job.attempt, 1);
  });

  contract('a lease that runs out lends the job again, redelivered', async (source, clock) => {
    await source.enqueue(requestOf('a'));
    const lost = (await source.reserve(LEASE)).lease;
    assert.strictEqual(lost.job.redeliveries, 0);
    clock.advance(LEASE / 2);
    assert.strictEqual(await source.extend(lost, LEASE), true);
    clock.advance(LEASE / 2 + 1);
    // Extended, it is still held.
    assert.strictEqual((await source.reserve(LEASE)).lease, undefined);
    clock.advance(LEASE);
    const again = (await source.reserve(LEASE)).lease;
    assert.strictEqual(again.job.id, 'a');
    assert.strictEqual(again.job.attempt, 1);
    assert.strictEqual(again.job.redelivered, true);
    assert.notStrictEqual(again.token, lost.token);
  });

  contract(
    'the runs that end unsettled are counted, and never counted down',
    async (source, clock) => {
      await source.enqueue(requestOf('poison'));
      for (let run = 0; run < 3; run++) {
        const { lease } = await source.reserve(LEASE);
        assert.strictEqual(lease.job.redeliveries, run);
        // The attempt is run again: only the count of lost runs grows.
        assert.strictEqual(lease.job.attempt, 1);
        clock.advance(LEASE + 1);
      }
      const { lease } = await source.reserve(LEASE);
      assert.strictEqual(lease.job.redeliveries, 3);
      // A release or a retry counts nothing.
      await source.release(lease);
      const released = (await source.reserve(LEASE)).lease;
      assert.strictEqual(released.job.redeliveries, 3);
      await source.retry(released, START, { code: 'x', reason: 'y' });
      assert.strictEqual((await source.reserve(LEASE)).lease.job.redeliveries, 3);
    },
  );

  contract('a lease lost writes nothing over the next one', async (source, clock) => {
    await source.enqueue(requestOf('a'));
    const lost = (await source.reserve(LEASE)).lease;
    clock.advance(LEASE + 1);
    const held = (await source.reserve(LEASE)).lease;
    assert.strictEqual(await source.extend(lost, LEASE), false);
    // Each settling write of a lost lease writes nothing, and says so.
    assert.strictEqual(await source.ack(lost, null), false);
    assert.strictEqual(await source.fail(lost, { code: 'x', reason: 'y' }), false);
    assert.strictEqual(await source.release(lost), false);
    assert.strictEqual(await source.retry(lost, START, { code: 'x', reason: 'y' }), false);
    // The job is still the next holder's.
    assert.strictEqual((await source.reserve(LEASE)).lease, undefined);
    assert.strictEqual(await source.extend(held, LEASE), true);
    assert.strictEqual(await source.ack(held, null), true);
    clock.advance(LEASE * 3);
    assert.strictEqual((await source.reserve(LEASE)).lease, undefined);
  });

  contract('a pause holds every job until its time, and only grows', async (source, clock) => {
    await source.enqueue(requestOf('a'));
    await source.pause(START + 2000);
    await source.pause(START + 1000);
    assert.deepStrictEqual(await source.reserve(LEASE), { nextAvailableAt: START + 2000 });
    clock.advance(2000);
    assert.strictEqual((await source.reserve(LEASE)).lease.job.id, 'a');
  });
};

module.exports = { LEASE, START, requestOf, sourceContract };
