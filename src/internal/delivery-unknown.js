// Not ported: marks the failures after which a message may have
// been accepted, so that a transport reports them as of unknown delivery
// rather than as retryable, whatever class of error carries them.

const unknownDeliveries = new WeakSet();

/**
 * Marks a failure that came after the provider took the request, such as an
 * unreadable body of a 2xx response.
 *
 * @param error The failure.
 * @returns The same failure, to throw.
 * @internal
 */
const markDeliveryUnknown = (error) => {
  unknownDeliveries.add(error);
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

module.exports = { isDeliveryUnknown, markDeliveryUnknown };
