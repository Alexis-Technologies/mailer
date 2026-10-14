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
    // Filter to enabled transports that haven't been attempted
    const availableTransports = transports
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => entry.enabled && !attemptedIndices.has(index));

    if (availableTransports.length < 1) return undefined;

    // Separate transports with selectors from those without
    const withSelectors = [];
    const withoutSelectors = [];

    for (const transport of availableTransports) {
      if (transport.entry.selector) {
        // Evaluate selector function
        try {
          if (transport.entry.selector(message)) {
            withSelectors.push(transport);
          }
        } catch {
          // If selector throws, skip this transport
        }
      } else {
        // No selector means it accepts all messages
        withoutSelectors.push(transport);
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
