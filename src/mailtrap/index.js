// Ported from upyo v0.7.0 (packages/mailtrap/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * @fileoverview Mailtrap transport for Upyo email library.
 *
 * This module provides a transport implementation for sending emails through
 * Mailtrap's HTTP API.  It supports Email API and Email Sandbox sending,
 * single messages, batch sending, attachments, and retry logic.
 */

const { MailtrapTransport } = require('./mailtrap-transport.js');
const { createMailtrapConfig } = require('./config.js');
const {
  MailtrapApiError,
  MailtrapResponseError,
  MailtrapTimeoutError,
} = require('./http-client.js');

module.exports = {
  MailtrapTransport,
  createMailtrapConfig,
  MailtrapApiError,
  MailtrapResponseError,
  MailtrapTimeoutError,
};
