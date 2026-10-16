// Ported from upyo v0.7.0 (packages/pool/src/strategies/selector-strategy.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Selector strategy that routes messages based on custom selector functions.
 *
 * This strategy evaluates each transport's selector function (if provided)
 * to determine if it should handle a specific message. Transports without
 * selectors are considered as catch-all fallbacks. Among matching transports,
 * one is selected randomly.
 */
class SelectorStrategy {
  /**
   * Selects a transport based on selector function matching.
   *
   * @param message The message to send.
   * @param transports Available transports.
   * @param attemptedIndices Indices of transports that have already been
   *                         attempted.
   * @returns The selected transport or `undefined` if no transport matches.
   */
  select(message, transports, attemptedIndices) {
    // Transports whose selector accepts the message, and those without a
    // selector, which accept every message, in one pass.
    const withSelectors = [];
    const withoutSelectors = [];

    for (let index = 0; index < transports.length; index++) {
      const entry = transports[index];
      if (!entry.enabled || attemptedIndices.has(index)) continue;
      if (entry.selector) {
        // Evaluate selector function
        try {
          if (entry.selector(message)) {
            withSelectors.push({ entry, index });
          }
        } catch {
          // If selector throws, skip this transport
        }
      } else {
        // No selector means it accepts all messages
        withoutSelectors.push({ entry, index });
      }
    }

    // Prefer transports with matching selectors
    const candidates = withSelectors.length > 0 ? withSelectors : withoutSelectors;

    if (candidates.length < 1) return undefined;

    // Select randomly from candidates
    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }

  /**
   * Resets the strategy (no-op for selector strategy as it's stateless).
   */
  reset() {
    // Selector strategy is stateless, nothing to reset
  }
}

module.exports = { SelectorStrategy };
