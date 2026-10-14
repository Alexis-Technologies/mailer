// Ported from upyo v0.7.0 (packages/jmap/src/test-utils/test-config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const process = require('node:process');

/**
 * Check if Stalwart testing is enabled via environment variables.
 * @returns true if STALWART_SESSION_URL and authentication credentials are set.
 */
const isStalwartTestingEnabled = () => {
  const sessionUrl = process.env.STALWART_SESSION_URL;
  const bearerToken = process.env.STALWART_BEARER_TOKEN;
  const basicUsername = process.env.STALWART_USERNAME;
  const basicPassword = process.env.STALWART_PASSWORD;
  return !!sessionUrl && (!!bearerToken || (!!basicUsername && !!basicPassword));
};

/**
 * Get test configuration from environment variables.
 * @returns Test configuration object.
 * @throws Error if required environment variables are not set.
 */
const getTestConfig = () => {
  const sessionUrl = process.env.STALWART_SESSION_URL;
  const bearerToken = process.env.STALWART_BEARER_TOKEN;
  const basicUsername = process.env.STALWART_USERNAME;
  const basicPassword = process.env.STALWART_PASSWORD;
  const apiUrl = process.env.STALWART_API_URL;
  const adminToken = process.env.STALWART_ADMIN_TOKEN;

  if (!sessionUrl) {
    throw new Error('STALWART_SESSION_URL environment variable must be set for E2E tests');
  }

  if (!bearerToken && (!basicUsername || !basicPassword)) {
    throw new Error(
      'Either STALWART_BEARER_TOKEN or (STALWART_USERNAME and STALWART_PASSWORD) must be set for E2E tests',
    );
  }

  // Extract base URL from session URL for URL rewriting
  const baseUrl =
    process.env.STALWART_BASE_URL ||
    sessionUrl.replace(/\/jmap\/session$/, '').replace(/\/.well-known\/jmap$/, '');

  const jmap = bearerToken
    ? {
        sessionUrl,
        bearerToken,
        timeout: 30000,
        retries: 3,
        baseUrl,
      }
    : {
        sessionUrl,
        basicAuth: {
          username: basicUsername,
          password: basicPassword,
        },
        timeout: 30000,
        retries: 3,
        baseUrl,
      };

  return {
    jmap,
    stalwart: {
      apiUrl: apiUrl || sessionUrl.replace('/jmap/session', ''),
      adminToken: adminToken || bearerToken || '',
    },
  };
};

/**
 * Create a test message for E2E tests.
 * @param options Options for the test message.
 * @returns A message object.
 */
const createTestMessage = (options = {}) => {
  const content = options.content || { text: 'This is a test email.' };
  const attachments = options.attachments || [];

  return {
    sender: {
      address: options.senderEmail || 'test@mail.example.com',
      name: options.senderName,
    },
    recipients: [
      {
        address: options.recipientEmail || 'recipient@mail.example.com',
      },
    ],
    ccRecipients: [],
    bccRecipients: [],
    replyRecipients: [],
    attachments,
    subject: options.subject || 'Test Email',
    content,
    priority: 'normal',
    tags: [],
    headers: new Headers(),
    messageId: options.messageId,
    date: options.date,
    inReplyTo: options.inReplyTo,
    references: options.references,
    calendar: options.calendar,
  };
};

module.exports = { isStalwartTestingEnabled, getTestConfig, createTestMessage };
