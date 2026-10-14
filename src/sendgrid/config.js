// Ported from upyo v0.7.0 (packages/sendgrid/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Creates a resolved SendGrid configuration by applying default values to optional fields.
 *
 * This function takes a partial SendGrid configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the SendGrid transport.
 *
 * @param config - The SendGrid configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */
const createSendGridConfig = (config) => {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? 'https://api.sendgrid.com/v3',
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    validateSsl: config.validateSsl ?? true,
    headers: config.headers ?? {},
    clickTracking: config.clickTracking ?? true,
    openTracking: config.openTracking ?? true,
    subscriptionTracking: config.subscriptionTracking ?? false,
    googleAnalytics: config.googleAnalytics ?? false,
  };
};

module.exports = { createSendGridConfig };
