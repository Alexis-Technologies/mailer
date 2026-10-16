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
// An AWS region, such as us-east-1, eu-central-1 or us-gov-west-1.
const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;

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
  // The region goes into the host name of every request, with the signature.
  if (!AWS_REGION.test(resolved.region)) {
    throw new TypeError(`Invalid AWS region: ${String(resolved.region)}`);
  }
  return resolved;
};

module.exports = { createSesConfig };
