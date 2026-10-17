// Ported from upyo v0.7.0 (packages/lettermint/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * @fileoverview Lettermint transport for Upyo email library.
 *
 * This module provides a transport implementation for sending emails through
 * Lettermint's HTTP API.  It supports single messages, batch sending,
 * attachments, provider-specific defaults, retry logic, and idempotency.
 */

const { LettermintTransport } = require('./lettermint-transport.js');
const { createLettermintConfig } = require('./config.js');
const { LettermintApiError, LettermintTimeoutError } = require('./http-client.js');

module.exports = {
  LettermintTransport,
  createLettermintConfig,
  LettermintApiError,
  LettermintTimeoutError,
};
