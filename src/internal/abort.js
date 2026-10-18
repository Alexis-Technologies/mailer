// Not ported: the abort of a caller's signal, read the one way every
// transport and decorator reads it: its reason, and whether an error is it.

/**
 * The reason of an aborted signal, or an `AbortError` when it has none.
 *
 * @param signal The aborted signal.
 * @returns The value to reject or throw with.
 * @internal
 */
const abortReason = (signal) =>
  signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');

/**
 * Whether a value is an `AbortError`.
 *
 * @internal
 */
const isAbortError = (error) => error instanceof Error && error.name === 'AbortError';

/**
 * Whether an error is the abort of the caller's own signal: its reason, or
 * an `AbortError` while it is aborted.
 *
 * @internal
 */
const isCallerAbort = (error, signal) =>
  signal?.aborted === true && (error === signal.reason || error?.name === 'AbortError');

module.exports = { abortReason, isAbortError, isCallerAbort };
