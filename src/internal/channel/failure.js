// Not ported: the receipt of a failure of a transport of a channel: the
// refusal of its converter of a message the provider's API would refuse,
// such as a text over the limit of a chat, a `validation` failure; or what
// providerFailure makes of the rest; each with the channel of the transport.
// Apart from internal/refusal.js, so that the email providers carry none of
// it.

const { createFailedReceipt } = require('../../core/receipt.js');
const { ProviderApiError, providerFailure } = require('../api-client.js');

/**
 * The refusal of a converter of a message the provider's API would refuse
 * whatever transport sent it: a TypeError that only a converter throws.
 *
 * @internal
 */
class InvalidMessageError extends TypeError {}

/**
 * The receipt of a failure of a transport of a channel.
 *
 * @param provider The provider's id.
 * @param channel The channel of the transport.
 * @param error What was thrown.
 * @returns A failed receipt with its channel.
 * @internal
 */
const channelFailure = (provider, channel, error) => {
  if (error instanceof InvalidMessageError) {
    return createFailedReceipt(error.message, {
      provider,
      channel,
      category: 'validation',
      retryable: false,
    });
  }
  // A failure that names its category before any answer of the provider,
  // such as a token of Google refused (internal/google-auth.js).
  if (!(error instanceof ProviderApiError) && typeof error?.category === 'string') {
    return createFailedReceipt(error.message, {
      provider,
      channel,
      category: error.category,
      retryable: error.retryable === true,
      statusCode: error.statusCode,
    });
  }
  return { ...providerFailure(provider, error), channel };
};

module.exports = { InvalidMessageError, channelFailure };
