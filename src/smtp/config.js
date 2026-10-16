// Ported from upyo v0.7.0 (packages/smtp/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { checkDkimConfig } = require('../mime/dkim/types.js');

/**
 * Creates a resolved SMTP configuration by applying default values to optional fields.
 *
 * This function takes a partial SMTP configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the SMTP transport.
 *
 * @param config - The SMTP configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */
const createSmtpConfig = (config) => {
  checkDkimConfig(config.dkim);
  const port = config.port ?? 587;

  return {
    host: config.host,
    port,
    secure: config.secure ?? port === 465,
    requireTls: config.requireTls ?? false,
    auth: config.auth,
    tls: config.tls,
    connectionTimeout: config.connectionTimeout ?? 60000,
    socketTimeout: config.socketTimeout ?? 60000,
    localName: config.localName ?? 'localhost',
    pool: config.pool ?? true,
    poolSize: config.poolSize ?? 5,
    dkim: config.dkim,
  };
};

module.exports = { createSmtpConfig };
