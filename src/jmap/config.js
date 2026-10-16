// Ported from upyo v0.7.0 (packages/jmap/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

/**
 * Creates a resolved JMAP configuration with default values applied.
 * @param config The user-provided configuration.
 * @returns The resolved configuration with all fields populated.
 * @throws Error if neither bearerToken nor basicAuth is provided.
 */
const createJmapConfig = (config) => {
  if (!config.bearerToken && !config.basicAuth) {
    throw new Error('Either bearerToken or basicAuth must be provided');
  }
  const resolved = {
    sessionUrl: config.sessionUrl,
    bearerToken: config.bearerToken ?? null,
    basicAuth: config.basicAuth ?? null,
    accountId: config.accountId ?? null,
    identityId: config.identityId ?? null,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    headers: config.headers ?? {},
    sessionCacheTtl: config.sessionCacheTtl ?? 300000,
    baseUrl: config.baseUrl ?? null,
    trustedOrigins: config.trustedOrigins ?? [],
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.sessionUrl, 'sessionUrl');
  if (resolved.baseUrl != null) checkSecureUrl(resolved.baseUrl, 'baseUrl');
  for (const origin of resolved.trustedOrigins) checkSecureUrl(origin, 'trustedOrigins');
  return resolved;
};

module.exports = { createJmapConfig };
