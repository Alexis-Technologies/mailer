// Ported from upyo v0.7.0 (packages/pool/src/test-utils/test-config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { MockTransport } = require('../../../src/mock/index.js');
const { PoolTransport } = require('../../../src/pool/pool-transport.js');

/**
 * Creates a test message with default values.
 */
const createTestMessage = (overrides) => {
  return {
    sender: { address: 'sender@example.com', name: 'Sender' },
    recipients: [{ address: 'recipient@example.com', name: 'Recipient' }],
    ccRecipients: [],
    bccRecipients: [],
    replyRecipients: [],
    attachments: [],
    subject: 'Test Subject',
    content: { text: 'Test content' },
    tags: [],
    priority: 'normal',
    headers: new Headers(),
    ...overrides,
  };
};

/**
 * Creates a mock transport that always succeeds.
 */
const createSuccessTransport = (messageId = 'success-id') => {
  const transport = new MockTransport();
  transport.setNextResponse({
    successful: true,
    messageId,
    provider: 'mock',
  });
  return transport;
};

/**
 * Creates a mock transport that always fails.
 */
const createFailureTransport = (errorMessage = 'Transport failed') => {
  const transport = new MockTransport();
  transport.setNextResponse({
    successful: false,
    errorMessages: [errorMessage],
    provider: 'mock',
  });
  return transport;
};

/**
 * Creates a mock transport that fails N times then succeeds.
 */
const createFlakeyTransport = (
  failureCount,
  successId = 'flaky-success',
  errorMessage = 'Temporary failure',
) => {
  const transport = new MockTransport();
  let attempts = 0;

  // Override send method to implement flaky behavior
  const originalSend = transport.send.bind(transport);
  transport.send = (message, options) => {
    attempts++;
    if (attempts <= failureCount) {
      transport.setNextResponse({
        successful: false,
        errorMessages: [errorMessage],
        provider: 'mock',
      });
    } else {
      transport.setNextResponse({
        successful: true,
        messageId: successId,
        provider: 'mock',
      });
    }
    return originalSend(message, options);
  };

  return transport;
};

/**
 * Creates a pool transport with the given configuration.
 */
const createTestPoolTransport = (config) => {
  return new PoolTransport({
    strategy: 'round-robin',
    ...config,
  });
};

module.exports = {
  createTestMessage,
  createSuccessTransport,
  createFailureTransport,
  createFlakeyTransport,
  createTestPoolTransport,
};
