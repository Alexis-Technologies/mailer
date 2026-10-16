// Ported from upyo v0.7.0 (packages/ses/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { checkRequestOptions } = require('../internal/config.js');

/**
 * Creates a resolved SES configuration with default values applied.
 *
 * This function takes a partial SES configuration and fills in default values
 * for all optional fields, ensuring the transport has all necessary configuration.
 *
 * @example
 * ```typescript
 * const config = createSesConfig({
 *   authentication: {
 *     type: "credentials",
 *     accessKeyId: "AKIA...",
 *     secretAccessKey: "wJal..",
 *   },
 *   region: "eu-west-1",
 * });
 *
 * // config.timeout is now 30000 (default)
 * // config.retries is now 3 (default)
 * // config.batchSize is now 50 (default)
 * ```
 *
 * @param config The SES configuration object.
 * @returns A resolved configuration with all defaults applied.
 */
const createSesConfig = (config) => {
  const resolved = {
    authentication: config.authentication,
    region: config.region ?? 'us-east-1',
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    validateSsl: config.validateSsl ?? true,
    headers: config.headers ?? {},
    configurationSetName: config.configurationSetName,
    defaultTags: config.defaultTags ?? {},
    batchSize: config.batchSize ?? 50,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  return resolved;
};

module.exports = { createSesConfig };
