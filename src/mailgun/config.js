// Ported from upyo v0.7.0 (packages/mailgun/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Creates a resolved Mailgun configuration by applying default values to optional fields.
 *
 * This function takes a partial Mailgun configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the Mailgun transport.
 *
 * @param config - The Mailgun configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */
const createMailgunConfig = (config) => {
  const region = config.region ?? 'us';
  const baseUrl = config.baseUrl ?? getDefaultBaseUrl(region);

  return {
    apiKey: config.apiKey,
    domain: config.domain,
    region,
    baseUrl,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    validateSsl: config.validateSsl ?? true,
    headers: config.headers ?? {},
    tracking: config.tracking ?? true,
    clickTracking: config.clickTracking ?? true,
    openTracking: config.openTracking ?? true,
  };
};

/**
 * Gets the default base URL for a given Mailgun region.
 *
 * @param region - The Mailgun region
 * @returns The default base URL for the region
 */
const getDefaultBaseUrl = (region) => {
  switch (region) {
    case 'us':
      return 'https://api.mailgun.net/v3';
    case 'eu':
      return 'https://api.eu.mailgun.net/v3';
    default:
      throw new Error(`Unsupported region: ${region}`);
  }
};

module.exports = { createMailgunConfig };
