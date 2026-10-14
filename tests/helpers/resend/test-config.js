// Ported from upyo v0.7.0 (packages/resend/src/test-utils/test-config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const process = require('node:process');

/**
 * Creates a test configuration for Resend transport from environment variables.
 *
 * This function reads the Resend API key from environment variables and
 * creates a configuration suitable for testing purposes.
 *
 * @returns Test configuration for Resend transport
 * @throws Error if required environment variables are not set
 */
const createTestConfig = () => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error(
      'RESEND_API_KEY environment variable is required for E2E tests. ' +
        'Please set it to your Resend API key.',
    );
  }

  const baseUrl = process.env.RESEND_BASE_URL;
  const recipientEmail = process.env.RESEND_TO;
  const verifiedDomain = process.env.RESEND_VERIFIED_DOMAIN;

  return {
    apiKey,
    ...(baseUrl && { baseUrl }),
    ...(recipientEmail && { recipientEmail }),
    ...(verifiedDomain && { verifiedDomain }),
    timeout: 30000,
    retries: 3,
  };
};

module.exports = { createTestConfig };
