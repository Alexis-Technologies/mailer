// Ported from upyo v0.7.0 (packages/plunk/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * @fileoverview Plunk transport for Upyo email library.
 *
 * This module provides a transport implementation for sending emails through
 * Plunk's HTTP API, supporting both cloud-hosted and self-hosted instances.
 */

const { PlunkTransport } = require('./plunk-transport.js');

module.exports = { PlunkTransport };
