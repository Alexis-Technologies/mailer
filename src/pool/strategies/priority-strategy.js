// Ported from upyo v0.7.0 (packages/pool/src/strategies/priority-strategy.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Priority strategy that selects transports based on priority values.
 *
 * This strategy always attempts to use the highest priority transport
 * first, falling back to lower priority transports only when higher
 * priority ones fail. Transports with the same priority are considered
 * equivalent and one is selected randomly.
 */
class PriorityStrategy {
  /**
   * Selects the highest priority transport that hasn't been attempted.
   *
   * @param _message The message to send (unused in this strategy).
   * @param transports Available transports.
   * @param attemptedIndices Indices of transports that have already been
   *                         attempted.
   * @returns The selected transport or `undefined` if all transports have been
   *          attempted.
   */
  select(_message, transports, attemptedIndices) {
    // The enabled transports not attempted yet that share the highest
    // priority, in their order, found in one pass rather than by mapping,
    // filtering and sorting them on every attempt.
    let topPriorityTransports = [];
    let highestPriority = -Infinity;
    for (let index = 0; index < transports.length; index++) {
      const entry = transports[index];
      if (!entry.enabled || attemptedIndices.has(index)) continue;
      if (entry.priority > highestPriority) {
        highestPriority = entry.priority;
        topPriorityTransports = [{ entry, index }];
      } else if (entry.priority === highestPriority) {
        topPriorityTransports.push({ entry, index });
      }
    }

    if (topPriorityTransports.length < 1) return undefined;

    // If multiple transports have the same priority, select randomly
    if (topPriorityTransports.length > 1) {
      const randomIndex = Math.floor(Math.random() * topPriorityTransports.length);
      return topPriorityTransports[randomIndex];
    }

    // Return the single highest priority transport
    return topPriorityTransports[0];
  }

  /**
   * Resets the strategy (no-op for priority strategy as it's stateless).
   */
  reset() {
    // Priority strategy is stateless, nothing to reset
  }
}

module.exports = { PriorityStrategy };
