// Not ported: a transport of SMS and Viber over the JSON API of AlphaSMS,
// written from its documentation: a message of `sms` or `viber` to a phone
// number, a hybrid of Viber with an SMS by `type: 'viber+sms'` and the
// fields of the SMS in the payload of a message of Viber; the `success` of
// the answer, then of its item, fails it.

const { createHash } = require('node:crypto');
const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure, InvalidMessageError } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { RefusalError } = require('../internal/refusal.js');
const { verifyByGet } = require('../internal/verify.js');
const { createAlphaSmsConfig } = require('./config.js');
const { classifyError, createAlphaSmsClient } = require('./http-client.js');

const PROVIDER = 'alphasms';
const E164 = /^\+[1-9]\d{1,14}$/;
const MAX_VIBER_TEXT = 1000;
const SMS_LIFETIME = [3600, 259200];
const VIBER_LIFETIME = [60, 259200];
const OWN_FIELDS = new Set(['id', 'phone']);

const invalid = (message) => new InvalidMessageError(`AlphaSMS: ${message}`);
const unsupported = (message) => new RefusalError(`AlphaSMS: ${message}`);

// The id of a message, a number: of its idempotency key, or a new one.
const idOf = (message, config) =>
  message.idempotencyKey === undefined
    ? config.generateId()
    : createHash('sha256').update(message.idempotencyKey).digest().readUIntBE(0, 6);

const lifetimeOf = (message, config, range) => {
  const seconds = Math.floor((message.expiresAt.getTime() - config.now()) / 1000);
  return Math.min(range[1], Math.max(range[0], seconds));
};

const smsOf = (item, message, config) => {
  if (message.media !== undefined && message.media.length > 0) {
    throw unsupported('an SMS carries no media.');
  }
  if (message.buttons !== undefined) throw unsupported('an SMS carries no buttons.');
  if (message.text === undefined) throw invalid('an SMS needs a text.');
  item.type = 'sms';
  item.sms_signature = message.from ?? config.sender;
  item.sms_message = message.text;
  if (message.expiresAt !== undefined) {
    item.sms_lifetime = lifetimeOf(message, config, SMS_LIFETIME);
  }
};

// A message of Viber: a text, a picture, a text with a link button, or a
// text with a picture and a link button.
const viberOf = (item, message, config) => {
  const media = message.media ?? [];
  if (media.length > 1) throw unsupported('a message of Viber carries one picture.');
  const [picture] = media;
  if (picture !== undefined && picture.url === undefined) {
    throw unsupported('a picture goes by its URL.');
  }
  const [button] = message.buttons ?? [];
  if (message.buttons !== undefined && (message.buttons.length > 1 || button.type !== 'url')) {
    throw unsupported('a message of Viber carries one button, a link.');
  }
  if (message.text !== undefined && message.text.length > MAX_VIBER_TEXT) {
    throw invalid(`the text of Viber is more than ${MAX_VIBER_TEXT} characters.`);
  }
  item.type = 'viber';
  item.viber_signature = message.from ?? config.viberSender;
  if (picture === undefined && button === undefined) {
    item.viber_type = 'text';
    item.viber_message = message.text;
  } else if (button === undefined && message.text === undefined) {
    item.viber_type = 'image';
    item.viber_image = picture.url;
  } else if (picture === undefined && message.text !== undefined) {
    item.viber_type = 'text+link';
    item.viber_message = message.text;
    item.viber_link = button.url;
    item.viber_button = button.text;
  } else if (picture !== undefined && button !== undefined && message.text !== undefined) {
    item.viber_type = 'text+image+link';
    item.viber_message = message.text;
    item.viber_image = picture.url;
    item.viber_link = button.url;
    item.viber_button = button.text;
  } else {
    throw unsupported(
      'a message of Viber is a text, a picture, or a text with a link button and a picture or not.',
    );
  }
  if (message.expiresAt !== undefined) {
    item.viber_lifetime = lifetimeOf(message, config, VIBER_LIFETIME);
  }
};

const itemOf = (message, config) => {
  if (message.channel !== 'sms' && message.channel !== 'viber') {
    throw unsupported(
      `the transport sends SMS and Viber, not messages of ${message.channel ?? 'email'}.`,
    );
  }
  if (typeof message.to !== 'string' || !E164.test(message.to)) {
    throw invalid('a message of AlphaSMS goes to a phone number in E.164.');
  }
  const item = { type: undefined, id: idOf(message, config), phone: Number(message.to.slice(1)) };
  if (message.channel === 'sms') smsOf(item, message, config);
  else viberOf(item, message, config);
  if (config.hook !== undefined) item.hook = config.hook;
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      item[name] = message.payload[name];
    }
  }
  if (item.type === 'viber+sms' && item.sms_signature === undefined) {
    item.sms_signature = config.sender;
  }
  if ((item.sms_signature ?? item.viber_signature) === undefined) {
    throw invalid('a message needs a signature: from.');
  }
  return item;
};

const receiptOf = (json, message) => {
  const fail = (error) =>
    createFailedReceipt(`AlphaSMS: ${typeof error === 'string' ? error : 'refused'}`, {
      provider: PROVIDER,
      channel: message.channel,
      ...classifyError(error),
      providerDetails: json,
    });
  if (json?.success === false) return fail(json.error);
  const item = Array.isArray(json?.data) ? json.data[0] : undefined;
  if (item?.success === false) return fail(item.error);
  const id = item?.data?.msg_id;
  if (json?.success !== true || item?.success !== true || id === undefined || id === null) {
    return createFailedReceipt('AlphaSMS answered without the id of the message.', {
      provider: PROVIDER,
      channel: message.channel,
      category: 'unknown',
      deliveryUnknown: true,
      deliveryUnknownReason: 'no-id',
    });
  }
  const receipt = {
    successful: true,
    messageId: String(id),
    provider: PROVIDER,
    channel: message.channel,
    state: 'accepted',
  };
  if (Number.isInteger(item.data.parts) && item.data.parts > 0) receipt.segments = item.data.parts;
  return receipt;
};

// The balance answers a refused key in a 200 too, by its success.
const checkBalance = (_status, text) => {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (json?.success !== true || json.data?.[0]?.success !== true) {
    throw Object.assign(
      new Error(
        `AlphaSMS refused the key: ${json?.error ?? json?.data?.[0]?.error ?? text.slice(0, 200)}`,
      ),
      { statusCode: 200 },
    );
  }
};

/**
 * A transport of SMS and Viber over the JSON API of AlphaSMS.
 */
class AlphaSmsTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createAlphaSmsConfig, createAlphaSmsClient);
  }

  /**
   * Sends one SMS or message of Viber.
   *
   * @param message An SMS, or a message of Viber to a phone number.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the `msg_id` its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sent) => itemOf(sent, this.config),
      request: (item, sendOptions) => this.httpClient.send(item, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json, message),
      failureOf: (error) => channelFailure(PROVIDER, message.channel ?? 'sms', error),
    });
  }

  /**
   * Checks the key by reading the balance of the account.
   *
   * @param options Optional abort signal.
   * @throws {Error} If AlphaSMS refuses it.
   */
  verify(options) {
    return verifyByGet(this, 'AlphaSMS', this.httpClient.url, options, {
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ auth: this.config.apiKey, data: [{ type: 'balance' }] }),
      },
      check: checkBalance,
    });
  }
}

module.exports = { AlphaSmsTransport };
