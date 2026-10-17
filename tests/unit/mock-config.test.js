// Ported from upyo v0.7.0 (packages/mock/src/config.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { createMockConfig } = require('../../src/mock/config.js');

describe('createMockConfig', () => {
  test('should apply default values for empty config', () => {
    const config = createMockConfig();

    assert.deepEqual(config.defaultResponse, {
      successful: true,
      messageId: 'mock-message-id',
      provider: 'mock',
    });
    assert.equal(config.delay, 0);
    assert.deepEqual(config.randomDelayRange, { min: 0, max: 0 });
    assert.equal(config.failureRate, 0);
    assert.equal(config.generateUniqueMessageIds, true);
  });

  test('should preserve provided values', () => {
    const inputConfig = {
      defaultResponse: {
        successful: false,
        errorMessages: ['Test error'],
      },
      delay: 100,
      randomDelayRange: { min: 50, max: 150 },
      failureRate: 0.1,
      generateUniqueMessageIds: false,
    };

    const config = createMockConfig(inputConfig);

    assert.deepEqual(config.defaultResponse, {
      successful: false,
      errorMessages: ['Test error'],
    });
    assert.equal(config.delay, 100);
    assert.deepEqual(config.randomDelayRange, { min: 50, max: 150 });
    assert.equal(config.failureRate, 0.1);
    assert.equal(config.generateUniqueMessageIds, false);
  });

  test('should apply defaults only to undefined fields', () => {
    const inputConfig = {
      delay: 50,
      failureRate: 0.05,
    };

    const config = createMockConfig(inputConfig);

    assert.deepEqual(config.defaultResponse, {
      successful: true,
      messageId: 'mock-message-id',
      provider: 'mock',
    });
    assert.equal(config.delay, 50);
    assert.deepEqual(config.randomDelayRange, { min: 0, max: 0 });
    assert.equal(config.failureRate, 0.05);
    assert.equal(config.generateUniqueMessageIds, true);
  });

  test('should handle successful response configuration', () => {
    const inputConfig = {
      defaultResponse: {
        successful: true,
        messageId: 'custom-message-id',
      },
    };

    const config = createMockConfig(inputConfig);

    assert.deepEqual(config.defaultResponse, {
      successful: true,
      messageId: 'custom-message-id',
    });
  });

  test('should handle failed response configuration', () => {
    const inputConfig = {
      defaultResponse: {
        successful: false,
        errorMessages: ['Network error', 'Timeout'],
      },
    };

    const config = createMockConfig(inputConfig);

    assert.deepEqual(config.defaultResponse, {
      successful: false,
      errorMessages: ['Network error', 'Timeout'],
    });
  });
});
