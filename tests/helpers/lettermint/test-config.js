// Ported from upyo v0.7.0 (packages/lettermint/src/test-utils/test-config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const process = require('node:process');

/**
 * Checks whether Lettermint E2E testing is configured.
 *
 * @returns `true` if all required environment variables are present.
 */
const isE2eTestingEnabled = () => {
  return !!(
    process.env.LETTERMINT_API_TOKEN &&
    process.env.LETTERMINT_FROM &&
    process.env.LETTERMINT_TO
  );
};

/**
 * Reads Lettermint E2E test configuration from environment variables.
 *
 * @returns Lettermint E2E test configuration.
 * @throws {Error} If required environment variables are missing.
 */
const getTestConfig = () => {
  const apiToken = process.env.LETTERMINT_API_TOKEN;
  const from = process.env.LETTERMINT_FROM;
  const to = process.env.LETTERMINT_TO;

  if (!apiToken || !from || !to) {
    throw new Error('LETTERMINT_API_TOKEN, LETTERMINT_FROM, and LETTERMINT_TO are required.');
  }

  return {
    lettermint: {
      apiToken,
      ...(process.env.LETTERMINT_BASE_URL && {
        baseUrl: process.env.LETTERMINT_BASE_URL,
      }),
    },
    from,
    to,
  };
};

/**
 * Creates a test message for Lettermint E2E tests.
 *
 * @param overrides Message fields to override.
 * @returns A test message.
 */
const createTestMessage = (overrides = {}) => {
  const config = getTestConfig();
  return {
    sender: { address: config.from, name: 'Upyo Test' },
    recipients: [{ address: config.to }],
    ccRecipients: [],
    bccRecipients: [],
    replyRecipients: [],
    subject: '[E2E] Lettermint test',
    content: { text: 'This is a test email sent through Lettermint.' },
    attachments: [],
    priority: 'normal',
    tags: ['upyo-test'],
    headers: new Headers(),
    ...overrides,
  };
};

module.exports = { isE2eTestingEnabled, getTestConfig, createTestMessage };
