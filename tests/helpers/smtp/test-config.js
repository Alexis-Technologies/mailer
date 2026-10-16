// Ported from upyo v0.7.0 (packages/smtp/src/test-utils/test-config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { isEmailAddress } = require('../../../src/core/address.js');
const process = require('node:process');

const getTestConfig = () => {
  if (!isMailpitTestingEnabled()) {
    throw new Error(
      'Mailpit testing is not enabled. Set MAILPIT_API_URL or MAILPIT_SMTP_HOST environment variables.',
    );
  }

  return {
    smtp: {
      host: process.env.MAILPIT_SMTP_HOST ?? 'localhost',
      port: parseInt(process.env.MAILPIT_SMTP_PORT ?? '1025', 10),
      secure: process.env.MAILPIT_SMTP_SECURE === 'true',
      tls: { rejectUnauthorized: false },
    },
    mailpit: {
      baseUrl: process.env.MAILPIT_API_URL ?? 'http://localhost:8025',
    },
  };
};

const isMailpitTestingEnabled = () => {
  return !!process.env.MAILPIT_API_URL || !!process.env.MAILPIT_SMTP_HOST;
};

/**
 * Whether the OAuth 2.0 end-to-end tests are configured to run.
 *
 * Requires a host, a user, and a token source: either a static access token
 * (`SMTP_OAUTH2_ACCESS_TOKEN`) or the refresh-token trio
 * (`SMTP_OAUTH2_REFRESH_TOKEN`, `SMTP_OAUTH2_CLIENT_ID`,
 * `SMTP_OAUTH2_TOKEN_ENDPOINT`).
 */
const isOAuth2TestingEnabled = () => {
  const hasTokenSource =
    !!process.env.SMTP_OAUTH2_ACCESS_TOKEN ||
    (!!process.env.SMTP_OAUTH2_REFRESH_TOKEN &&
      !!process.env.SMTP_OAUTH2_CLIENT_ID &&
      !!process.env.SMTP_OAUTH2_TOKEN_ENDPOINT);
  return !!process.env.SMTP_OAUTH2_HOST && !!process.env.SMTP_OAUTH2_USER && hasTokenSource;
};

/**
 * Builds the OAuth 2.0 SMTP test configuration from environment variables.
 *
 * @throws {Error} If OAuth 2.0 testing is not enabled.
 */
const getOAuth2TestConfig = () => {
  if (!isOAuth2TestingEnabled()) {
    throw new Error(
      'OAuth 2.0 testing is not enabled. Set SMTP_OAUTH2_HOST, ' +
        'SMTP_OAUTH2_USER, and a token source (SMTP_OAUTH2_ACCESS_TOKEN, or ' +
        'the SMTP_OAUTH2_REFRESH_TOKEN/SMTP_OAUTH2_CLIENT_ID/' +
        'SMTP_OAUTH2_TOKEN_ENDPOINT trio).',
    );
  }

  const user = process.env.SMTP_OAUTH2_USER;
  const mechanism = process.env.SMTP_OAUTH2_MECHANISM;
  const method = mechanism === 'oauthbearer' || mechanism === 'xoauth2' ? mechanism : undefined;

  // An empty SMTP_OAUTH2_ACCESS_TOKEN is treated as "not set" (matching
  // isOAuth2TestingEnabled), so the refresh-token flow is used in that case.
  const accessToken = process.env.SMTP_OAUTH2_ACCESS_TOKEN;
  const usesRefreshFlow = !accessToken;
  const auth = accessToken
    ? {
        user,
        accessToken,
        method,
      }
    : {
        user,
        clientId: process.env.SMTP_OAUTH2_CLIENT_ID,
        clientSecret: process.env.SMTP_OAUTH2_CLIENT_SECRET,
        refreshToken: process.env.SMTP_OAUTH2_REFRESH_TOKEN,
        tokenEndpoint: process.env.SMTP_OAUTH2_TOKEN_ENDPOINT,
        scope: process.env.SMTP_OAUTH2_SCOPE,
        method,
      };

  return {
    smtp: {
      host: process.env.SMTP_OAUTH2_HOST,
      port: parseInt(process.env.SMTP_OAUTH2_PORT ?? '587', 10),
      secure: process.env.SMTP_OAUTH2_SECURE === 'true',
      auth,
    },
    from: process.env.SMTP_OAUTH2_FROM ?? user,
    to: process.env.SMTP_OAUTH2_TO ?? user,
    usesRefreshFlow,
  };
};

const createTestMessage = (options = {}) => {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substr(2, 9);

  const senderEmail = options.senderEmail ?? 'sender@example.com';
  const recipientEmail = options.recipientEmail ?? 'recipient@example.com';

  if (!isEmailAddress(senderEmail)) {
    throw new Error(`Invalid sender email address: ${senderEmail}`);
  }
  if (!isEmailAddress(recipientEmail)) {
    throw new Error(`Invalid recipient email address: ${recipientEmail}`);
  }

  return {
    sender: {
      name: options.senderName ?? 'Test Sender',
      address: senderEmail,
    },
    recipients: options.recipients ?? [
      {
        name: 'Test Recipient',
        address: recipientEmail,
      },
    ],
    ccRecipients: options.ccRecipients ?? [],
    bccRecipients: options.bccRecipients ?? [],
    replyRecipients: options.replyRecipients ?? [],
    subject: options.subject ?? `Test Email ${timestamp}`,
    content: options.content ?? { text: `Test message content ${randomId}` },
    attachments: options.attachments ?? [],
    priority: options.priority ?? 'normal',
    tags: options.tags ?? [],
    headers: options.headers ?? new Headers(),
    messageId: options.messageId,
    date: options.date,
    inReplyTo: options.inReplyTo,
    references: options.references,
    calendar: options.calendar,
  };
};

module.exports = {
  getTestConfig,
  isMailpitTestingEnabled,
  isOAuth2TestingEnabled,
  getOAuth2TestConfig,
  createTestMessage,
};
