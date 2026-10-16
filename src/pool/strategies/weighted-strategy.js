// Ported from upyo v0.7.0 (packages/pool/src/strategies/weighted-strategy.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Weighted strategy that distributes traffic based on configured weights.
 *
 * This strategy uses weighted random selection to distribute messages
 * across transports proportionally to their configured weights.
 * A transport with weight 2 will receive approximately twice as many
 * messages as a transport with weight 1.
 */
class WeightedStrategy {
  /**
   * @param options `random`, the source of the random choices; by default
   *                `Math.random`, read at each choice.
   */
  constructor(options) {
    this.random = options?.random;
  }

  /**
   * Selects a transport based on weighted random distribution.
   *
   * @param _message The message to send (unused in this strategy).
   * @param transports Available transports.
   * @param attemptedIndices Indices of transports that have already been
   *                         attempted.
   * @returns The selected transport or `undefined` if all transports have been
   *          attempted.
   */
  select(_message, transports, attemptedIndices) {
    // The total weight of the enabled transports not attempted yet, in one
    // pass without building a list of them.
    let totalWeight = 0;
    let lastIndex = -1;
    for (let index = 0; index < transports.length; index++) {
      const entry = transports[index];
      if (!entry.enabled || !(entry.weight > 0) || attemptedIndices.has(index)) continue;
      totalWeight += entry.weight;
      lastIndex = index;
    }

    if (lastIndex === -1 || totalWeight <= 0) return undefined;

    // Random selection based on weights
    const random = (this.random ?? Math.random)() * totalWeight;
    let cumulativeWeight = 0;

    for (let index = 0; index < transports.length; index++) {
      const entry = transports[index];
      if (!entry.enabled || !(entry.weight > 0) || attemptedIndices.has(index)) continue;
      cumulativeWeight += entry.weight;
      if (random < cumulativeWeight) {
        return { entry, index };
      }
    }

    // Fallback to last available transport (shouldn't normally reach here)
    return { entry: transports[lastIndex], index: lastIndex };
  }

  /**
   * Resets the strategy (no-op for weighted strategy as it's stateless).
   */
  reset() {
    // Weighted strategy is stateless, nothing to reset
  }
}

module.exports = { WeightedStrategy };
