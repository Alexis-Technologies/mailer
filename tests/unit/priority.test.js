// Ported from upyo v0.7.0 (packages/core/src/priority.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { comparePriority } = require('../../src/core/priority.js');
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('comparePriority()', () => {
  const priorities = ['normal', 'low', 'high'];
  priorities.sort(comparePriority);
  assert.deepStrictEqual(priorities, ['high', 'normal', 'low']);

  // Test individual comparisons
  assert.strictEqual(comparePriority('high', 'normal'), -1);
  assert.strictEqual(comparePriority('normal', 'high'), 1);
  assert.strictEqual(comparePriority('low', 'normal'), 1);
  assert.strictEqual(comparePriority('normal', 'low'), -1);
  assert.strictEqual(comparePriority('high', 'low'), -1);
  assert.strictEqual(comparePriority('low', 'high'), 1);
});
