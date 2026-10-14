// Ported from upyo v0.7.0 (packages/jmap/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * @alexify/mailer/jmap - JMAP transport for Upyo email library
 * RFC 8620 (core) and RFC 8621 (mail) compliant
 * @module
 */

const { JmapTransport } = require('./jmap-transport.js');
const { createJmapConfig } = require('./config.js');
const { isCapabilityError, JMAP_ERROR_TYPES, JmapApiError } = require('./errors.js');

const { uploadBlob } = require('./blob-uploader.js');

module.exports = {
  JmapTransport,
  createJmapConfig,
  isCapabilityError,
  JMAP_ERROR_TYPES,
  JmapApiError,
  uploadBlob,
};
