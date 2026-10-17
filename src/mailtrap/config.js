// Ported from upyo v0.7.0 (packages/mailtrap/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { checkRequestOptions, checkSecureUrl } = require('../internal/config.js');
const { checkValidateSsl } = require('../internal/validate-ssl.js');

const DEFAULT_SEND_BASE_URL = 'https://send.api.mailtrap.io';
const DEFAULT_SANDBOX_BASE_URL = 'https://sandbox.api.mailtrap.io';
const DEFAULT_CATEGORY = 'transactional';
const DEFAULT_USER_AGENT = '@alexify/mailer/mailtrap';

/**
 * Creates a resolved Mailtrap configuration by applying default values.
 *
 * @param config The Mailtrap configuration with optional fields.
 * @returns A resolved configuration with all defaults applied.
 * @throws {RangeError} If `sandbox` is `true` and `inboxId` is missing.
 */
const createMailtrapConfig = (config) => {
  checkValidateSsl(config.validateSsl);
  const sandbox = config.sandbox ?? false;

  if (sandbox && !isValidInboxId(config.inboxId)) {
    throw new RangeError('`inboxId` is required when Mailtrap sandbox mode is enabled.');
  }

  const resolved = {
    apiToken: config.apiToken,
    sandbox,
    inboxId: config.inboxId,
    sendBaseUrl: normalizeBaseUrl(config.sendBaseUrl ?? DEFAULT_SEND_BASE_URL),
    sandboxBaseUrl: normalizeBaseUrl(config.sandboxBaseUrl ?? DEFAULT_SANDBOX_BASE_URL),
    defaultCategory: config.defaultCategory ?? DEFAULT_CATEGORY,
    metadata: config.metadata == null ? undefined : { ...config.metadata },
    userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
    timeout: config.timeout ?? 30000,
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
    retries: config.retries ?? 3,
    validateSsl: true,
    headers: config.headers == null ? {} : { ...config.headers },
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.sendBaseUrl, 'sendBaseUrl');
  checkSecureUrl(resolved.sandboxBaseUrl, 'sandboxBaseUrl');
  return resolved;
};

const isValidInboxId = (inboxId) => {
  if (inboxId === undefined || inboxId === null) return false;
  if (typeof inboxId === 'number') return Number.isFinite(inboxId);
  return inboxId.trim().length > 0;
};

const normalizeBaseUrl = (baseUrl) => {
  return baseUrl.replace(/\/+$/, '');
};

module.exports = { createMailtrapConfig };
