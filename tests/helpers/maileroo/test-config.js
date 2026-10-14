// Ported from upyo v0.7.0 (packages/maileroo/src/test-utils/test-config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const process = require('node:process');

/**
 * Error thrown when Maileroo E2E test configuration is incomplete.
 */
class MailerooTestConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailerooTestConfigError';
  }
}

/**
 * Checks whether Maileroo E2E testing is configured.
 *
 * @returns `true` if all required environment variables are present.
 */
const isE2eTestingEnabled = () => {
  return !!(process.env.MAILEROO_API_KEY && process.env.MAILEROO_FROM && process.env.MAILEROO_TO);
};

/**
 * Reads Maileroo E2E test configuration from environment variables.
 *
 * @returns Maileroo E2E test configuration.
 * @throws {MailerooTestConfigError} If required environment variables are
 * missing.
 */
const getTestConfig = () => {
  const apiKey = process.env.MAILEROO_API_KEY;
  const from = process.env.MAILEROO_FROM;
  const to = process.env.MAILEROO_TO;

  if (!apiKey || !from || !to) {
    throw new MailerooTestConfigError(
      'MAILEROO_API_KEY, MAILEROO_FROM, and MAILEROO_TO are required.',
    );
  }

  return {
    maileroo: {
      apiKey,
      timeout: 60000,
      retries: 6,
      ...(process.env.MAILEROO_BASE_URL && {
        baseUrl: process.env.MAILEROO_BASE_URL,
      }),
    },
    from,
    to,
  };
};

/**
 * Creates a test message for Maileroo E2E tests.
 *
 * @param overrides Message fields to override.
 * @returns A test message.
 * @throws {MailerooTestConfigError} If required environment variables are
 * missing.
 */
const createTestMessage = (overrides = {}) => {
  const config = getTestConfig();
  return {
    sender: { address: config.from, name: 'Upyo Test' },
    recipients: [{ address: config.to }],
    ccRecipients: [],
    bccRecipients: [],
    replyRecipients: [],
    subject: '[E2E] Maileroo test',
    content: { text: 'This is a test email sent through Maileroo.' },
    attachments: [],
    priority: 'normal',
    tags: ['upyo-test'],
    headers: new Headers(),
    ...overrides,
  };
};

module.exports = { MailerooTestConfigError, isE2eTestingEnabled, getTestConfig, createTestMessage };
