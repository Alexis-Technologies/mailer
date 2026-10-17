// Ported from upyo v0.7.0 (packages/maileroo/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * @fileoverview Maileroo transport for Upyo email library.
 *
 * This module provides a transport implementation for sending emails through
 * Maileroo's HTTP API.  It supports single messages, sequential `sendMany()`,
 * attachments, custom headers, tags, tracking settings, retry logic, and
 * cancellation.
 */

const { MailerooTransport } = require('./maileroo-transport.js');
const { createMailerooConfig } = require('./config.js');
const { MailerooApiError, MailerooTimeoutError } = require('./http-client.js');

module.exports = {
  MailerooTransport,
  createMailerooConfig,
  MailerooApiError,
  MailerooTimeoutError,
};
