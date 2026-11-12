// Not ported: a transport of SMS over the JSON API of SMS Club, written from
// its documentation: an SMS to a number from its alpha name, the id of the
// SMS the key of the `info` of its answer.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const {
  channelFailure,
  InvalidMessageError,
  noIdReceipt,
} = require('../internal/channel/failure.js');
const { countSegments } = require('../internal/channel/segments.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { RefusalError } = require('../internal/refusal.js');
const { verifyByGet } = require('../internal/verify.js');
const { createSmsClubConfig } = require('./config.js');
const { createSmsClubClient } = require('./http-client.js');

const PROVIDER = 'smsclub';
const OWN_FIELDS = new Set(['phone', 'message']);

const invalid = (message) => new InvalidMessageError(`SMS Club: ${message}`);

const bodyOf = (message, config) => {
  if (message.channel !== 'sms') {
    throw new RefusalError(
      `SMS Club: the transport sends SMS, not messages of ${message.channel ?? 'email'}.`,
    );
  }
  if (message.media !== undefined && message.media.length > 0) {
    throw new RefusalError('SMS Club: an SMS carries no media.');
  }
  if (message.buttons !== undefined) throw new RefusalError('SMS Club: an SMS carries no buttons.');
  if (message.text === undefined) throw invalid('an SMS needs a text.');
  const sender = message.from ?? config.sender;
  if (sender === undefined) throw invalid('an SMS needs a sender: from.');
  const body = { phone: [message.to.slice(1)], message: message.text, src_addr: sender };
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      body[name] = message.payload[name];
    }
  }
  return body;
};

const MAX_REASONS = 3;
const MAX_REASON_LENGTH = 200;

// The reasons of an `add_info`, without its keys, which are the numbers it
// refused: a receipt, and the audit after it, never holds a recipient.
const reasonsOf = (info) => {
  if (typeof info === 'string') return info.slice(0, MAX_REASON_LENGTH);
  let text = '';
  let count = 0;
  for (const key in info) {
    const reason = info[key];
    if (typeof reason !== 'string' || count === MAX_REASONS) continue;
    text += count === 0 ? reason : `; ${reason}`;
    count++;
  }
  return text === '' ? 'no reason given' : text.slice(0, MAX_REASON_LENGTH);
};

// The receipt of an answer: the id the `info` names, or a refusal its
// `add_info` tells.
const receiptOf = (json, message) => {
  const request = json?.success_request;
  let id;
  for (const key in request?.info) {
    id = key;
    break;
  }
  if (id !== undefined) {
    return {
      successful: true,
      messageId: id,
      provider: PROVIDER,
      channel: 'sms',
      state: 'accepted',
      segments: countSegments(message.text).segments,
    };
  }
  if (request?.add_info !== undefined) {
    return createFailedReceipt(`SMS Club refused the SMS: ${reasonsOf(request.add_info)}`, {
      provider: PROVIDER,
      channel: 'sms',
      category: 'rejected',
      code: 'smsclub.add_info',
    });
  }
  return noIdReceipt('SMS Club answered without the id of the SMS.', PROVIDER, 'sms');
};

/**
 * A transport of SMS over the JSON API of SMS Club.
 */
class SmsClubTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createSmsClubConfig, createSmsClubClient);
  }

  /**
   * Sends one SMS.
   *
   * @param message An SMS.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the id of the SMS its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sent) => bodyOf(sent, this.config),
      request: (body, sendOptions) => this.httpClient.send(body, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json, message),
      failureOf: (error) => channelFailure(PROVIDER, 'sms', error),
    });
  }

  /**
   * Checks the token by reading the balance of the account.
   *
   * @param options Optional abort signal.
   * @throws {Error} If SMS Club refuses it.
   */
  verify(options) {
    return verifyByGet(this, 'SMS Club', this.httpClient.balanceUrl, options, {
      init: { method: 'POST', headers: { Accept: 'application/json' } },
    });
  }
}

module.exports = { SmsClubTransport };
