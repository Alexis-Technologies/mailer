// Not ported: a transport of SMS and Viber over the HTTP API of TurboSMS,
// written from its documentation: a message of `sms` or `viber` to a phone
// number, a hybrid of Viber with an SMS when Viber does not deliver by
// `sms` in the payload of a message of Viber; the code of the answer, then
// of its recipient, fails it, and FAILED_DUPLICATE_REQUEST answers the
// results of the same request, executed once.

const { generateId } = require('../core/id.js');
const { createFailedReceipt } = require('../core/receipt.js');

const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure, InvalidMessageError } = require('../internal/channel/failure.js');
const { countSegments } = require('../internal/channel/segments.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { RefusalError } = require('../internal/refusal.js');
const { toUuid } = require('../internal/uuid.js');
const { verifyByGet } = require('../internal/verify.js');
const { createTurboSmsConfig } = require('./config.js');
const { classifyCode, createTurboSmsClient } = require('./http-client.js');

const PROVIDER = 'turbosms';
// What TurboSMS takes of an SMS, ten parts: 1521 characters of GSM-7, 661 of
// UCS-2, a little less than ten parts would hold.
const MAX_GSM7_UNITS = 1521;
const MAX_UCS2_UNITS = 661;
const MAX_VIBER_TEXT = 1000;
const MAX_CAPTION = 30;
const MIN_TTL = 30;
const MAX_TTL = 86400;
const DUPLICATE_REQUEST = 507;
const DUPLICATE_MESSAGE = 427;
const ACCEPTED = new Set([800, 801, 802, 803, DUPLICATE_REQUEST]);
const OWN_FIELDS = new Set(['recipients', 'sequence_id']);
// A number in E.164: an SMS was normalized so; Viber is held to it here.
const E164 = /^\+[1-9]\d{1,14}$/;

const invalid = (message) => new InvalidMessageError(`TurboSMS: ${message}`);
const unsupported = (message) => new RefusalError(`TurboSMS: ${message}`);

const smsOf = (message, config) => {
  if (message.media !== undefined && message.media.length > 0) {
    throw unsupported('an SMS carries no media.');
  }
  if (message.buttons !== undefined) throw unsupported('an SMS carries no buttons.');
  if (message.text === undefined) throw invalid('an SMS needs a text.');
  const { encoding, units } = countSegments(message.text);
  const limit = encoding === 'GSM-7' ? MAX_GSM7_UNITS : MAX_UCS2_UNITS;
  if (units > limit) {
    throw invalid(`the text is more than the ${limit} characters of ${encoding} TurboSMS takes.`);
  }
  return { sender: message.from ?? config.sender, text: message.text };
};

const viberOf = (message, config) => {
  const viber = { sender: message.from ?? config.viberSender };
  if (message.text !== undefined) {
    if (message.text.length > MAX_VIBER_TEXT) {
      throw invalid(`the text of Viber is more than ${MAX_VIBER_TEXT} characters.`);
    }
    viber.text = message.text;
  }
  const media = message.media ?? [];
  if (media.length > 1) throw unsupported('a message of Viber carries one picture.');
  if (media.length === 1) {
    if (media[0].url === undefined) throw unsupported('a picture goes by its URL.');
    viber.image_url = media[0].url;
  }
  if (message.buttons !== undefined) {
    const [button] = message.buttons;
    if (message.buttons.length > 1 || button.type !== 'url') {
      throw unsupported('a message of Viber carries one button, a link.');
    }
    if (button.text.length > MAX_CAPTION) {
      throw invalid(`the text of the button is more than ${MAX_CAPTION} characters.`);
    }
    viber.caption = button.text;
    viber.action = button.url;
  }
  if (message.expiresAt !== undefined) {
    const seconds = Math.floor((message.expiresAt.getTime() - config.now()) / 1000);
    viber.ttl = Math.min(MAX_TTL, Math.max(MIN_TTL, seconds));
  }
  return viber;
};

const bodyOf = (message, config, sequenceId) => {
  if (message.channel !== 'sms' && message.channel !== 'viber') {
    throw unsupported(
      `the transport sends SMS and Viber, not messages of ${message.channel ?? 'email'}.`,
    );
  }
  if (typeof message.to !== 'string' || !E164.test(message.to)) {
    throw invalid('a message of TurboSMS goes to a phone number in E.164.');
  }
  const body = { recipients: [message.to.slice(1)], sequence_id: sequenceId };
  if (message.channel === 'sms') body.sms = smsOf(message, config);
  else body.viber = viberOf(message, config);
  const channel = body.sms ?? body.viber;
  if (channel.sender === undefined) throw invalid('a message needs a sender: from.');
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      body[name] = message.payload[name];
    }
  }
  if (body.sms !== undefined && body.sms.sender === undefined && config.sender !== undefined) {
    body.sms = { sender: config.sender, ...body.sms };
  }
  return body;
};

// The same message created within 90 seconds, NOT_ALLOWED_MESSAGE_DUPLICATE:
// it went then, so this one is of unknown delivery rather than refused.
const duplicate = (message) =>
  createFailedReceipt('TurboSMS created this message within 90 seconds, so not again.', {
    provider: PROVIDER,
    channel: message.channel,
    category: 'unknown',
    deliveryUnknown: true,
    deliveryUnknownReason: 'duplicate',
    code: 'turbosms.427',
  });

// The receipt of an answer: its code, then the code of its recipient.
const receiptOf = (json, message) => {
  const fail = (code, reason) =>
    createFailedReceipt(`TurboSMS: ${reason ?? `code ${String(code)}`}`, {
      provider: PROVIDER,
      channel: message.channel,
      ...classifyCode(code),
      // The code, not the answer, whose results name the phone.
      providerDetails: { response_code: code, response_status: reason },
    });
  const code = json?.response_code;
  if (typeof code !== 'number') {
    return createFailedReceipt('TurboSMS answered without the code of the request.', {
      provider: PROVIDER,
      channel: message.channel,
      category: 'unknown',
      deliveryUnknown: true,
      deliveryUnknownReason: 'unreadable-answer',
    });
  }
  const [recipient] = Array.isArray(json.response_result) ? json.response_result : [];
  if (!ACCEPTED.has(code)) {
    // A request refused whole, unless the code is its recipient's.
    if (recipient?.response_code === undefined) {
      return code === DUPLICATE_MESSAGE ? duplicate(message) : fail(code, json.response_status);
    }
  }
  if (recipient !== undefined && recipient.response_code !== 0) {
    if (recipient.response_code === DUPLICATE_MESSAGE) return duplicate(message);
    return fail(recipient.response_code, recipient.response_status);
  }
  if (typeof recipient?.message_id !== 'string' || recipient.message_id === '') {
    return createFailedReceipt('TurboSMS answered without the id of the message.', {
      provider: PROVIDER,
      channel: message.channel,
      category: 'unknown',
      deliveryUnknown: true,
      deliveryUnknownReason: 'no-id',
    });
  }
  const receipt = {
    successful: true,
    messageId: recipient.message_id,
    provider: PROVIDER,
    channel: message.channel,
    state: 'accepted',
  };
  if (message.channel === 'sms') receipt.segments = countSegments(message.text).segments;
  return receipt;
};

// The balance answers a refused token in a 200 too, by its code.
const checkBalance = (_status, text) => {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (json?.response_code !== 0) {
    throw Object.assign(
      new Error(`TurboSMS refused the token: ${json?.response_status ?? text.slice(0, 200)}`),
      { statusCode: 200, code: `turbosms.${json?.response_code}` },
    );
  }
};

/**
 * A transport of SMS and Viber over the HTTP API of TurboSMS.
 */
class TurboSmsTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createTurboSmsConfig, createTurboSmsClient);
  }

  /**
   * Sends one SMS or message of Viber, under a sequence_id of its own.
   *
   * @param message An SMS, or a message of Viber to a phone number.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the `message_id` its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    // A UUID, 36 characters, within the 40 a sequence_id takes, whatever the
    // generator of the transport gives.
    const sequenceId = toUuid(generateId('idempotency-key', this.config.generateId));
    return sendConverted(message, options, {
      provider: PROVIDER,
      now: this.config.now,
      convert: (sent) => bodyOf(sent, this.config, sequenceId),
      request: (body, sendOptions) => this.httpClient.send(body, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json, message),
      failureOf: (error) => channelFailure(PROVIDER, message.channel ?? 'sms', error),
    });
  }

  /**
   * Checks the token by reading the balance of the account.
   *
   * @param options Optional abort signal.
   * @throws {Error} If TurboSMS refuses it.
   */
  verify(options) {
    return verifyByGet(this, 'TurboSMS', this.httpClient.balanceUrl, options, {
      init: { method: 'POST', headers: { Accept: 'application/json' } },
      check: checkBalance,
    });
  }
}

module.exports = { TurboSmsTransport };
