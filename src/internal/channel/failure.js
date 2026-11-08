// Not ported: the receipt of a failure of a transport of a channel: the
// refusal of its converter of a message the provider's API would refuse,
// such as a text over the limit of a chat, a `validation` failure; or what
// providerFailure makes of the rest; each with the channel of the transport.
// Apart from internal/refusal.js, so that the email providers carry none of
// it.

const { createFailedReceipt } = require('../../core/receipt.js');
const { providerFailure } = require('../api-client.js');

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
  return { ...providerFailure(provider, error), channel };
};

module.exports = { InvalidMessageError, channelFailure };
