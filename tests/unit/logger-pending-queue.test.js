// Ported from upyo v0.7.0 (packages/logtape/src/pending-queue.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');
const { PendingQueue } = require('../../src/logger/pending-queue.js');

describe('PendingQueue', () => {
  it('dequeues values in constant-time FIFO order', () => {
    const queue = new PendingQueue();

    for (let value = 0; value < 10_000; value++) {
      queue.enqueue(value);
    }

    for (let value = 0; value < 10_000; value++) {
      assert.equal(queue.dequeue(), value);
    }
    assert.equal(queue.size, 0);
    assert.equal(queue.dequeue(), undefined);
  });

  it('iterates only values that have not been dequeued', () => {
    const queue = new PendingQueue();
    queue.enqueue('first');
    queue.enqueue('second');
    queue.enqueue('third');

    assert.equal(queue.dequeue(), 'first');
    assert.deepEqual([...queue], ['second', 'third']);
    assert.equal(queue.size, 2);
  });
});
