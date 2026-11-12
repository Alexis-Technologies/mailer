// Not ported: marks the failures after which a message may have
// been accepted, so that a transport reports them as of unknown delivery
// rather than as retryable, whatever class of error carries them.

// Each marked failure with why its delivery is unknown, when it is told.
const unknownDeliveries = new WeakMap();

/**
 * Marks a failure that came after the provider took the request, such as an
 * unreadable body of a 2xx response.
 *
 * @param error The failure.
 * @param reason Why: one of `DELIVERY_UNKNOWN_REASONS` of the core.
 * @returns The same failure, to throw.
 * @internal
 */
const markDeliveryUnknown = (error, reason) => {
  // A failure marked again keeps the reason it was first marked with.
  if (!unknownDeliveries.has(error) || unknownDeliveries.get(error) === undefined) {
    unknownDeliveries.set(error, reason);
  }
  return error;
};

/**
 * Whether a failure was marked by {@link markDeliveryUnknown}.
 *
 * @param error The failure.
 * @returns `true` when the message may have been accepted.
 * @internal
 */
const isDeliveryUnknown = (error) =>
  typeof error === 'object' && error !== null && unknownDeliveries.has(error);

/**
 * Why a failure marked by {@link markDeliveryUnknown} left its delivery
 * unknown, when it was told.
 *
 * @param error The failure.
 * @returns The reason, or `undefined`.
 * @internal
 */
const deliveryUnknownReasonOf = (error) =>
  typeof error === 'object' && error !== null ? unknownDeliveries.get(error) : undefined;

module.exports = { deliveryUnknownReasonOf, isDeliveryUnknown, markDeliveryUnknown };
