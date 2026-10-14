// Ported from upyo v0.7.0 (packages/pool/src/strategies/round-robin-strategy.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Round-robin strategy that cycles through transports in order.
 *
 * This strategy maintains an internal counter and selects transports
 * in a circular fashion, ensuring even distribution of messages across
 * all enabled transports.
 */
class RoundRobinStrategy {
  currentIndex = 0;

  /**
   * Selects the next transport in round-robin order.
   *
   * @param _message The message to send (unused in this strategy).
   * @param transports Available transports.
   * @param attemptedIndices Indices of transports that have already been
   *                         attempted.
   * @returns The selected transport or `undefined` if all transports have been
   *          attempted.
   */
  select(_message, transports, attemptedIndices) {
    const enabledCount = transports.filter((t) => t.enabled).length;
    if (enabledCount < 1) return undefined;

    // Try up to the number of enabled transports
    for (let attempts = 0; attempts < enabledCount; attempts++) {
      // Find the next enabled transport
      while (!transports[this.currentIndex].enabled) {
        this.currentIndex = (this.currentIndex + 1) % transports.length;
      }

      const index = this.currentIndex;
      const entry = transports[index];

      // Move to next for the next call
      this.currentIndex = (this.currentIndex + 1) % transports.length;

      // Skip if already attempted
      if (attemptedIndices.has(index)) continue;

      return { entry, index };
    }

    return undefined;
  }

  /**
   * Resets the round-robin counter to start from the beginning.
   */
  reset() {
    this.currentIndex = 0;
  }
}

module.exports = { RoundRobinStrategy };
