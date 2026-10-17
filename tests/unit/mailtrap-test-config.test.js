// Ported from upyo v0.7.0 (packages/mailtrap/src/test-utils/test-config.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const process = require('node:process');
const { getTestConfig, isE2eTestingEnabled } = require('../helpers/mailtrap/test-config.js');

const environmentKeys = ['MAILTRAP_API_TOKEN', 'MAILTRAP_INBOX_ID', 'MAILTRAP_FROM', 'MAILTRAP_TO'];

describe('Mailtrap E2E test config', () => {
  it('rejects invalid email addresses', () => {
    const originalEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );

    try {
      process.env.MAILTRAP_API_TOKEN = 'test-token';
      process.env.MAILTRAP_INBOX_ID = '12345';
      process.env.MAILTRAP_FROM = 'not-an-email';
      process.env.MAILTRAP_TO = 'recipient@example.com';

      assert.ok(!isE2eTestingEnabled());
      assert.throws(getTestConfig, {
        name: 'TypeError',
        message: 'MAILTRAP_FROM and MAILTRAP_TO must be valid email addresses.',
      });
    } finally {
      for (const key of environmentKeys) {
        const value = originalEnvironment[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
