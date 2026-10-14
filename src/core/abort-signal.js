// Ported from upyo v0.7.0 (packages/core/src/abort-signal.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Combines a primary abort signal with an optional external signal.
 *
 * The returned signal aborts as soon as either input signal aborts, with the
 * reason of the signal that aborted first (`AbortSignal.any()`).
 *
 * @param primarySignal The signal owned by the current operation.
 * @param externalSignal Optional caller-supplied signal to compose.
 * @returns A combined signal and cleanup callback.
 */
const combineSignals = (primarySignal, externalSignal) => {
  if (externalSignal == null) {
    return { signal: primarySignal, cleanup: () => {} };
  }

  return {
    signal: AbortSignal.any([primarySignal, externalSignal]),
    cleanup: () => {},
  };
};

module.exports = { combineSignals };
