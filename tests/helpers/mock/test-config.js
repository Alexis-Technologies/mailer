// Ported from upyo v0.7.0 (packages/mock/src/test-utils/test-config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createMessage } = require('../../../src/core/message.js');
const { MockTransport } = require('../../../src/mock/mock-transport.js');
const { createMockConfig } = require('../../../src/mock/config.js');

/**
 * Creates a test MockTransport with default configuration.
 *
 * @param config Optional configuration overrides
 * @returns A configured MockTransport instance
 */
const createTestMockTransport = (config) => {
  return new MockTransport(createMockConfig(config));
};

/**
 * Creates a test message with sensible defaults for testing.
 *
 * @param overrides Optional properties to override defaults
 * @returns A test Message object
 */
const createTestMessage = (overrides = {}) => {
  return createMessage({
    from: overrides.from ?? 'test-sender@example.com',
    to: overrides.to ?? 'test-recipient@example.com',
    subject: overrides.subject ?? 'Test Email',
    content: overrides.content ?? { text: 'This is a test email message.' },
  });
};

module.exports = { createTestMockTransport, createTestMessage };
