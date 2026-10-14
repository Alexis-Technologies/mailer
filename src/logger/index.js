// Ported from upyo v0.7.0 (packages/logtape/src/index.ts), as ./logger.
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * @alexify/mailer/logger - the delivery lifecycle of email, logged through a
 * pino-like logger the application passes in.
 *
 * @module
 */

const { LoggerTransport } = require('./logger-transport.js');

module.exports = { LoggerTransport };
