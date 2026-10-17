// Not ported: tests of what the webhook verifiers share.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  createMemoryReplayStore,
  dateOf,
  equalBytes,
  headerOf,
} = require('../../src/webhooks/request.js');

test('Webhooks: a header field is read from Headers or from Node headers, in any case', () => {
  const headers = new Headers({ 'Svix-Id': 'msg_1' });
  assert.strictEqual(headerOf({ headers }, 'svix-id'), 'msg_1');
  assert.strictEqual(headerOf({ headers }, 'svix-timestamp'), undefined);
  assert.strictEqual(headerOf({ headers: { 'svix-id': 'msg_2' } }, 'Svix-Id'), 'msg_2');
  assert.strictEqual(headerOf({ headers: { 'X-Twilio': ['a', 'b'] } }, 'x-twilio'), 'a');
  assert.strictEqual(headerOf({ headers: { other: 'x' } }, 'svix-id'), undefined);
  assert.strictEqual(headerOf({}, 'svix-id'), undefined);
  assert.strictEqual(headerOf(undefined, 'svix-id'), undefined);
});

test('Webhooks: secrets compare in constant time, a length apart is unequal', () => {
  assert.strictEqual(equalBytes(Buffer.from('abc'), Buffer.from('abc')), true);
  assert.strictEqual(equalBytes(Buffer.from('abc'), Buffer.from('abd')), false);
  assert.strictEqual(equalBytes(Buffer.from('abc'), Buffer.from('abcd')), false);
});

test('Webhooks: dates come from seconds, milliseconds or ISO text', () => {
  assert.strictEqual(dateOf(1_700_000_000).getTime(), 1_700_000_000_000);
  assert.strictEqual(dateOf(1_700_000_000_123).getTime(), 1_700_000_000_123);
  assert.strictEqual(dateOf('1700000000.5').getTime(), 1_700_000_000_500);
  assert.strictEqual(dateOf('2026-10-17T12:00:00Z').toISOString(), '2026-10-17T12:00:00.000Z');
  assert.strictEqual(dateOf('yesterday'), undefined);
  assert.strictEqual(dateOf(''), undefined);
  assert.strictEqual(dateOf(undefined), undefined);
  assert.strictEqual(dateOf(Number.NaN), undefined);
});

test('Webhooks: the memory replay store forgets an id after its time, the oldest first', () => {
  let time = 0;
  const store = createMemoryReplayStore({ maxEntries: 2, now: () => time });
  assert.strictEqual(store.add('a', 100), true);
  assert.strictEqual(store.add('a', 100), false);
  time = 100;
  assert.strictEqual(store.add('a', 100), true);
  assert.strictEqual(store.add('b', 1000), true);
  assert.strictEqual(store.add('c', 1000), true);
  // Three ids for two places: a, the oldest, goes.
  assert.strictEqual(store.add('a', 100), true);
  assert.strictEqual(store.add('c', 1000), false);
  assert.throws(() => createMemoryReplayStore({ maxEntries: 0 }), /maxEntries/);
  assert.throws(() => createMemoryReplayStore({ now: 1 }), /now must be a function/);
  assert.strictEqual(createMemoryReplayStore().add('x', 1), true);
});
