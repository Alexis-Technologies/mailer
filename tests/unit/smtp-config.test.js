// Ported from upyo v0.7.0 (packages/smtp/src/config.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { createSmtpConfig } = require('../../src/smtp/config.js');

describe('createSmtpConfig', () => {
  test('should disable implicit TLS by default on port 587', () => {
    const config = createSmtpConfig({ host: 'smtp.example.com' });

    assert.equal(config.port, 587);
    assert.ok(!config.secure);
  });

  test('should enable implicit TLS by default on port 465', () => {
    const config = createSmtpConfig({
      host: 'smtp.example.com',
      port: 465,
    });

    assert.ok(config.secure);
  });

  test('should disable implicit TLS by default on other ports', () => {
    const config = createSmtpConfig({
      host: 'smtp.example.com',
      port: 25,
    });

    assert.ok(!config.secure);
  });

  test('should preserve explicit implicit TLS settings', () => {
    const secureConfig = createSmtpConfig({
      host: 'smtp.example.com',
      port: 587,
      secure: true,
    });
    const insecureConfig = createSmtpConfig({
      host: 'smtp.example.com',
      port: 465,
      secure: false,
    });

    assert.ok(secureConfig.secure);
    assert.ok(!insecureConfig.secure);
  });

  test('should not require TLS by default', () => {
    const config = createSmtpConfig({ host: 'smtp.example.com' });

    assert.ok(!config.requireTls);
  });

  test('should preserve an explicit TLS requirement', () => {
    const config = createSmtpConfig({
      host: 'smtp.example.com',
      requireTls: true,
    });

    assert.ok(config.requireTls);
  });
});
