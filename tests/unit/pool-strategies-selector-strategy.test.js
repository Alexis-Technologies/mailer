// Ported from upyo v0.7.0 (packages/pool/src/strategies/selector-strategy.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { SelectorStrategy } = require('../../src/pool/strategies/selector-strategy.js');
const { createTestMessage } = require('../helpers/pool/test-config.js');
const { MockTransport } = require('../../src/mock/index.js');

describe('SelectorStrategy', () => {
  const createTestEntries = () => {
    return [
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        selector: (msg) => msg.tags?.includes('newsletter'),
      },
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        selector: (msg) => msg.priority === 'high',
      },
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        // No selector - accepts all
      },
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: false,
        selector: (msg) => msg.tags?.includes('promo'),
      },
    ];
  };

  test('should select transport with matching selector', () => {
    const strategy = new SelectorStrategy();
    const transports = createTestEntries();
    const message = createTestMessage({ tags: ['newsletter', 'marketing'] });
    const attemptedIndices = new Set();

    const selection = strategy.select(message, transports, attemptedIndices);
    assert.ok(selection);
    assert.equal(selection.index, 0);
  });

  test('should select transport without selector as fallback', () => {
    const strategy = new SelectorStrategy();
    const transports = createTestEntries();
    const message = createTestMessage({ tags: ['transactional'] });
    const attemptedIndices = new Set();

    // No selector matches, should select transport without selector (index 2)
    const selection = strategy.select(message, transports, attemptedIndices);
    assert.ok(selection);
    assert.equal(selection.index, 2);
  });

  test('should randomly select among multiple matching transports', () => {
    const strategy = new SelectorStrategy();
    const transports = [
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        selector: (msg) => msg.tags?.includes('test'),
      },
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        selector: (msg) => msg.tags?.includes('test'),
      },
    ];
    const message = createTestMessage({ tags: ['test'] });
    const attemptedIndices = new Set();

    // Count selections over many iterations
    const selectionCounts = new Map();
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      const selection = strategy.select(message, transports, attemptedIndices);
      if (selection) {
        selectionCounts.set(selection.index, (selectionCounts.get(selection.index) || 0) + 1);
      }
    }

    // Both should be selected at least once
    assert.ok((selectionCounts.get(0) || 0) > 0);
    assert.ok((selectionCounts.get(1) || 0) > 0);
  });

  test('should skip disabled transports even if selector matches', () => {
    const strategy = new SelectorStrategy();
    const transports = createTestEntries();
    const message = createTestMessage({ tags: ['promo'] });
    const attemptedIndices = new Set();

    // Index 3 has matching selector but is disabled
    // Should fall back to transport without selector (index 2)
    const selection = strategy.select(message, transports, attemptedIndices);
    assert.ok(selection);
    assert.equal(selection.index, 2);
  });

  test('should skip already attempted transports', () => {
    const strategy = new SelectorStrategy();
    const transports = createTestEntries();
    const message = createTestMessage({ tags: ['newsletter'] });
    const attemptedIndices = new Set([0]); // Already tried matching transport

    // Should fall back to transport without selector
    const selection = strategy.select(message, transports, attemptedIndices);
    assert.ok(selection);
    assert.equal(selection.index, 2);
  });

  test('should handle selector that throws error', () => {
    const strategy = new SelectorStrategy();
    const transports = [
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        selector: (_msg) => {
          throw new Error('Selector error');
        },
      },
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        // No selector
      },
    ];
    const message = createTestMessage();
    const attemptedIndices = new Set();

    // Should skip transport with throwing selector and select fallback
    const selection = strategy.select(message, transports, attemptedIndices);
    assert.ok(selection);
    assert.equal(selection.index, 1);
  });

  test('should return undefined when no transport matches or available', () => {
    const strategy = new SelectorStrategy();
    const transports = [
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        selector: (msg) => msg.tags?.includes('newsletter'),
      },
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        selector: (msg) => msg.priority === 'high',
      },
    ];
    const message = createTestMessage({ tags: ['other'] });
    const attemptedIndices = new Set();

    // No selector matches and no fallback available
    const selection = strategy.select(message, transports, attemptedIndices);
    assert.equal(selection, undefined);
  });

  test('should prioritize selector matches over fallbacks', () => {
    const strategy = new SelectorStrategy();
    const transports = [
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        // No selector - fallback
      },
      {
        transport: new MockTransport(),
        weight: 1,
        priority: 0,
        enabled: true,
        selector: (msg) => msg.priority === 'high',
      },
    ];
    const message = createTestMessage({ priority: 'high' });
    const attemptedIndices = new Set();

    // Should select transport with matching selector (index 1) over fallback
    const selection = strategy.select(message, transports, attemptedIndices);
    assert.ok(selection);
    assert.equal(selection.index, 1);
  });

  test('reset() should be a no-op', () => {
    const strategy = new SelectorStrategy();
    const transports = createTestEntries();
    const message = createTestMessage({ tags: ['newsletter'] });
    const attemptedIndices = new Set();

    // Select before reset
    const selection1 = strategy.select(message, transports, attemptedIndices);
    assert.ok(selection1);

    // Reset should not affect stateless strategy
    strategy.reset();

    // Should still select matching transport
    const selection2 = strategy.select(message, transports, attemptedIndices);
    assert.ok(selection2);
    assert.equal(selection2.index, 0);
  });
});
