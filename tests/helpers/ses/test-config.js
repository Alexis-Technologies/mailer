// Ported from upyo v0.7.0 (packages/ses/src/test-utils/test-config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const createTestSesConfig = (overrides = {}) => {
  return {
    authentication: {
      type: 'credentials',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    },
    region: 'us-east-1',
    timeout: 30000,
    retries: 0,
    ...overrides,
  };
};

const createTestSessionConfig = (overrides = {}) => {
  return {
    authentication: {
      type: 'session',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      sessionToken: 'example-session-token',
    },
    region: 'us-east-1',
    timeout: 30000,
    retries: 0,
    ...overrides,
  };
};

module.exports = { createTestSesConfig, createTestSessionConfig };
