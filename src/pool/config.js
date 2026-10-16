// Ported from upyo v0.7.0 (packages/pool/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Creates a resolved pool configuration with defaults applied.
 *
 * @param config The pool configuration.
 * @returns The resolved configuration with defaults.
 * @throws {Error} If the configuration is invalid.
 */
const createPoolConfig = (config) => {
  if (!config.transports || config.transports.length === 0) {
    throw new Error('Pool must have at least one transport');
  }

  const enabledTransports = config.transports.filter((entry) => entry.enabled !== false);

  if (enabledTransports.length === 0) {
    throw new Error('Pool must have at least one enabled transport');
  }

  const resolvedTransports = config.transports.map((entry) => ({
    transport: entry.transport,
    weight: entry.weight ?? 1,
    priority: entry.priority ?? 0,
    selector: entry.selector,
    enabled: entry.enabled ?? true,
  }));

  // Validate weights for weighted strategy
  if (config.strategy === 'weighted') {
    const hasValidWeights = resolvedTransports.some((entry) => entry.enabled && entry.weight > 0);
    if (!hasValidWeights) {
      throw new Error(
        'Weighted strategy requires at least one enabled transport with positive weight',
      );
    }
  }

  return {
    strategy: config.strategy,
    transports: resolvedTransports,
    maxRetries: config.maxRetries ?? enabledTransports.length - 1,
    timeout: config.timeout,
    continueOnSuccess: config.continueOnSuccess ?? false,
    random: config.random,
    generateId: config.generateId,
  };
};

module.exports = { createPoolConfig };
