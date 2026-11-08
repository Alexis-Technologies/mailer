// Not ported: a transport over the REST Bot API of Viber, written from its
// documentation, as viber-bot is Apache-2.0: a message as `send_message` of
// its type (text, or a picture with its text), its buttons as a keyboard,
// the correlation id its `tracking_data`; the `status` of the 200 Viber
// answers fails the message, a user who never subscribed to the bot
// `not-on-channel`.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure, InvalidMessageError } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { RefusalError } = require('../internal/refusal.js');
const { verifyByGet } = require('../internal/verify.js');
const { createViberConfig, MAX_SENDER_NAME } = require('./config.js');
const { classifyStatus, createViberClient } = require('./http-client.js');

const PROVIDER = 'viber';
const MAX_TEXT = 7000;
const MAX_PICTURE_TEXT = 768;
const MAX_BUTTONS = 24;
const MAX_TRACKING_DATA = 4096;

const invalid = (message) => new InvalidMessageError(`Viber: ${message}`);
const unsupported = (message) => new RefusalError(`Viber: ${message}`);

// The buttons as a keyboard: a link opened, a reply its id sent back.
const keyboardOf = (buttons) => {
  if (buttons.length > MAX_BUTTONS) throw invalid(`a keyboard has ${MAX_BUTTONS} buttons at most.`);
  const list = [];
  for (const button of buttons) {
    if (button.type === 'call') throw unsupported('a button of Viber opens a link or replies.');
    list.push({
      ActionType: button.type === 'url' ? 'open-url' : 'reply',
      ActionBody: button.type === 'url' ? button.url : button.id,
      Text: button.text,
    });
  }
  return { Type: 'keyboard', Buttons: list };
};

const bodyOf = (message, config) => {
  if (message.channel !== 'viber') {
    throw unsupported(
      `the transport sends messages of Viber, not of ${message.channel ?? 'email'}.`,
    );
  }
  const sender = { ...config.sender };
  if (message.from !== undefined) {
    if (message.from.length > MAX_SENDER_NAME) {
      throw invalid(`the name of the sender is more than ${MAX_SENDER_NAME} characters.`);
    }
    sender.name = message.from;
  }
  const body = { receiver: message.to, sender };
  const media = message.media ?? [];
  if (media.length > 1) throw unsupported('a message carries one picture.');
  const [picture] = media;
  if (picture === undefined) {
    if (message.text !== undefined) {
      if (message.text.length > MAX_TEXT) {
        throw invalid(`the text is more than ${MAX_TEXT} characters.`);
      }
      body.type = 'text';
      body.text = message.text;
    }
  } else {
    if (
      picture.url === undefined ||
      (picture.contentType !== undefined && !picture.contentType.startsWith('image/'))
    ) {
      throw unsupported('a medium is a picture at its URL; a video or a file goes by the payload.');
    }
    const text = message.text ?? '';
    if (text.length > MAX_PICTURE_TEXT) {
      throw invalid(`the text of a picture is more than ${MAX_PICTURE_TEXT} characters.`);
    }
    body.type = 'picture';
    body.text = text;
    body.media = picture.url;
  }
  if (message.buttons !== undefined) body.keyboard = keyboardOf(message.buttons);
  const correlationId = message.metadata?.correlationId;
  if (correlationId !== undefined && correlationId.length <= MAX_TRACKING_DATA) {
    body.tracking_data = correlationId;
  }
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (name === 'receiver') throw invalid('the payload cannot set receiver.');
      body[name] = message.payload[name];
    }
  }
  if (body.type === undefined) {
    throw invalid('a message needs a text, a picture or a payload with its type.');
  }
  return body;
};

// The receipt of an answer: its status, then the token of the message.
const receiptOf = (answer) => {
  const status = answer.json?.status;
  if (typeof status !== 'number') {
    // Viber took the request and answered what is no answer of its own.
    return createFailedReceipt('Viber answered without the status of the message.', {
      provider: PROVIDER,
      channel: 'viber',
      category: 'unknown',
      deliveryUnknown: true,
    });
  }
  if (status !== 0) {
    const reason = answer.json?.status_message ?? `status ${String(status)}`;
    return createFailedReceipt(`Viber: ${reason}`, {
      provider: PROVIDER,
      channel: 'viber',
      ...classifyStatus(status),
      providerDetails: answer.json,
    });
  }
  if (answer.messageToken === undefined) {
    return createFailedReceipt('Viber answered without the token of the message.', {
      provider: PROVIDER,
      channel: 'viber',
      category: 'unknown',
      deliveryUnknown: true,
    });
  }
  return {
    successful: true,
    messageId: answer.messageToken,
    provider: PROVIDER,
    channel: 'viber',
    state: 'accepted',
  };
};

// The account answers a refused token in a 200 too, by its status.
const checkAccount = (_status, text) => {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (json?.status !== 0) {
    throw Object.assign(
      new Error(`Viber refused the token: ${json?.status_message ?? text.slice(0, 200)}`),
      { statusCode: 200, code: `viber.${json?.status}` },
    );
  }
};

/**
 * A transport of messages of a bot of Viber, over its REST Bot API.
 */
class ViberTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createViberConfig, createViberClient);
  }

  /**
   * Sends one message to a user subscribed to the bot.
   *
   * @param message A message of Viber.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the `message_token` its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sent) => bodyOf(sent, this.config),
      request: (body, sendOptions) => this.httpClient.send(body, sendOptions),
      receiptOf,
      failureOf: (error) => channelFailure(PROVIDER, 'viber', error),
    });
  }

  /**
   * Checks the token by reading the account of the bot.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Viber refuses it.
   */
  verify(options) {
    return verifyByGet(this, 'Viber', this.httpClient.accountUrl, options, {
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      check: checkAccount,
    });
  }
}

module.exports = { ViberTransport };
