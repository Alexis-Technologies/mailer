// Ported from upyo v0.7.0 (packages/mailtrap/src/test-utils/test-config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { isEmailAddress } = require('../../../src/core/address.js');
const process = require('node:process');

/**
 * Checks whether Mailtrap E2E testing is configured.
 *
 * @returns `true` if all required environment variables are present.
 */
const isE2eTestingEnabled = () => {
  return Boolean(
    process.env.MAILTRAP_API_TOKEN &&
    process.env.MAILTRAP_INBOX_ID &&
    isEmailAddress(process.env.MAILTRAP_FROM) &&
    isEmailAddress(process.env.MAILTRAP_TO),
  );
};

/**
 * Reads Mailtrap E2E test configuration from environment variables.
 *
 * @returns Mailtrap E2E test configuration.
 * @throws {Error} If required environment variables are missing.
 * @throws {TypeError} If the sender or recipient is not a valid email address.
 */
const getTestConfig = () => {
  const apiToken = process.env.MAILTRAP_API_TOKEN;
  const inboxId = process.env.MAILTRAP_INBOX_ID;
  const from = process.env.MAILTRAP_FROM;
  const to = process.env.MAILTRAP_TO;

  if (!apiToken || !inboxId || !from || !to) {
    throw new Error(
      'MAILTRAP_API_TOKEN, MAILTRAP_INBOX_ID, MAILTRAP_FROM, and MAILTRAP_TO are required.',
    );
  }

  if (!isEmailAddress(from) || !isEmailAddress(to)) {
    throw new TypeError('MAILTRAP_FROM and MAILTRAP_TO must be valid email addresses.');
  }

  return {
    mailtrap: {
      apiToken,
      sandbox: process.env.MAILTRAP_SANDBOX !== 'false',
      inboxId,
      ...(process.env.MAILTRAP_SEND_BASE_URL && {
        sendBaseUrl: process.env.MAILTRAP_SEND_BASE_URL,
      }),
      ...(process.env.MAILTRAP_SANDBOX_BASE_URL && {
        sandboxBaseUrl: process.env.MAILTRAP_SANDBOX_BASE_URL,
      }),
    },
    from,
    to,
  };
};

/**
 * Creates a test message for Mailtrap E2E tests.
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
    subject: '[E2E] Mailtrap test',
    content: { text: 'This is a test email sent through Mailtrap.' },
    attachments: [],
    priority: 'normal',
    tags: ['mailer-test'],
    headers: new Headers(),
    ...overrides,
  };
};

module.exports = { isE2eTestingEnabled, getTestConfig, createTestMessage };
