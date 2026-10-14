// Ported from upyo v0.7.0 (packages/resend/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Creates a resolved Resend configuration by applying default values to optional fields.
 *
 * This function takes a partial Resend configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the Resend transport.
 *
 * @param config - The Resend configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */
const createResendConfig = (config) => {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? 'https://api.resend.com',
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    validateSsl: config.validateSsl ?? true,
    headers: config.headers ?? {},
  };
};

module.exports = { createResendConfig };
