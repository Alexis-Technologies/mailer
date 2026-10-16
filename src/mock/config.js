// Ported from upyo v0.7.0 (packages/mock/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Creates a resolved mock configuration by applying default values to optional fields.
 *
 * This function takes a partial mock configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 *
 * @param config - The mock configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 *
 * @example
 * ```typescript
 * const resolved = createMockConfig({
 *   delay: 100
 * });
 *
 * // resolved.defaultResponse will be { successful: true, messageId: "mock-message-id" }
 * // resolved.failureRate will be 0 (default)
 * // resolved.generateUniqueMessageIds will be true (default)
 * ```
 */
const createMockConfig = (config = {}) => {
  return {
    defaultResponse: config.defaultResponse ?? {
      successful: true,
      messageId: 'mock-message-id',
      provider: 'mock',
    },
    delay: config.delay ?? 0,
    randomDelayRange: config.randomDelayRange ?? { min: 0, max: 0 },
    failureRate: config.failureRate ?? 0,
    generateUniqueMessageIds: config.generateUniqueMessageIds ?? true,
    random: config.random,
  };
};

module.exports = { createMockConfig };
