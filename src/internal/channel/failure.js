// Not ported: the receipt of a failure of a transport of a channel: the
// refusal of its converter of a message the provider's API would refuse,
// such as a text over the limit of a chat, a `validation` failure; or what
// providerFailure makes of the rest; each with the channel of the transport.
// Apart from internal/refusal.js, so that the email providers carry none of
// it.

const { createFailedReceipt } = require('../../core/receipt.js');
const { ProviderApiError, providerFailure } = require('../api-client.js');
const { deliveryUnknownReasonOf, isDeliveryUnknown } = require('../delivery-unknown.js');

// The answer of an error of an API of phone numbers names the number it
// refused (the message of Twilio's 21211, the Message of AWS), which redaction
// finds in a text but not in an object a receipt keeps whole: an error of a
// receipt of these keeps its status and code, not the answer.
const PHONE_CHANNELS = new Set(['sms', 'rcs', 'whatsapp']);

const withoutDetails = (errors) => {
  const kept = [];
  for (const receiptError of errors) {
    if (receiptError.providerDetails === undefined) {
      kept.push(receiptError);
      continue;
    }
    const copy = { ...receiptError };
    delete copy.providerDetails;
    kept.push(copy);
  }
  return kept;
};

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
  // An earlier attempt of unknown delivery leaves it so, whatever this one
  // failed of.
  if (!(error instanceof ProviderApiError) && typeof error?.category === 'string') {
    return createFailedReceipt(error.message, {
      provider,
      channel,
      category: error.category,
      retryable: error.retryable === true,
      statusCode: error.statusCode,
      deliveryUnknown: isDeliveryUnknown(error),
      deliveryUnknownReason: deliveryUnknownReasonOf(error),
      attempts: Number.isInteger(error.attempts) ? error.attempts : undefined,
    });
  }
  const receipt = providerFailure(provider, error);
  return PHONE_CHANNELS.has(channel)
    ? { ...receipt, errors: withoutDetails(receipt.errors), channel }
    : { ...receipt, channel };
};

/**
 * The receipt of an answer that took the message and named no id of it: of
 * unknown delivery, as the provider took it.
 *
 * @param text What the provider left out, such as "Telegram answered without
 * the id of the message.".
 * @param provider The provider's id.
 * @param channel The channel of the message.
 * @returns The failed receipt.
 * @internal
 */
const noIdReceipt = (text, provider, channel) =>
  createFailedReceipt(text, {
    provider,
    channel,
    category: 'unknown',
    deliveryUnknown: true,
    deliveryUnknownReason: 'no-id',
  });

module.exports = { InvalidMessageError, channelFailure, noIdReceipt };
