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
  // Upstream accepted it and never read it; honored, it would send a message
  // that went out through one transport again through the others.
  if (config.continueOnSuccess) {
    throw new TypeError(
      '`continueOnSuccess` is not supported: it would deliver a sent message again through ' +
        'the other transports.',
    );
  }
  if (!config.transports || config.transports.length === 0) {
    throw new Error('Pool must have at least one transport');
  }

  // One pass resolves the entries and counts what the checks need.
  const resolvedTransports = [];
  let enabledCount = 0;
  let hasValidWeights = false;
  for (const entry of config.transports) {
    const resolved = {
      transport: entry.transport,
      weight: entry.weight ?? 1,
      priority: entry.priority ?? 0,
      selector: entry.selector,
      enabled: entry.enabled ?? true,
    };
    if (entry.enabled !== false) enabledCount++;
    if (resolved.enabled && resolved.weight > 0) hasValidWeights = true;
    resolvedTransports.push(resolved);
  }

  if (enabledCount === 0) {
    throw new Error('Pool must have at least one enabled transport');
  }
  // Validate weights for weighted strategy
  if (config.strategy === 'weighted' && !hasValidWeights) {
    throw new Error(
      'Weighted strategy requires at least one enabled transport with positive weight',
    );
  }

  return {
    strategy: config.strategy,
    transports: resolvedTransports,
    maxRetries: config.maxRetries ?? enabledCount - 1,
    timeout: config.timeout,
    random: config.random,
    generateId: config.generateId,
    logger: config.logger,
  };
};

module.exports = { createPoolConfig };
