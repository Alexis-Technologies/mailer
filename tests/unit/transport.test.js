// Ported from upyo v0.7.0 (packages/core/src/transport.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isVerifiableTransport } = require('../../src/core/transport.js');

test('verification is an optional capability preserving the provider', async () => {
  const transport = {
    id: 'test',
    send: () => Promise.resolve({ successful: true, messageId: 'x' }),
    async *sendMany() {},
  };
  assert.ok(!isVerifiableTransport(transport));
  const invalid = { ...transport, verify: true };
  assert.ok(!isVerifiableTransport(invalid));
  let called = false;
  const capable = Object.assign({}, transport, {
    verify: () => {
      called = true;
      return Promise.resolve();
    },
  });
  assert.ok(isVerifiableTransport(capable));
  const narrowed = capable;
  assert.equal(await narrowed.verify(), undefined);
  assert.ok(called);
});
