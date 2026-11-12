// Ported from @thinwrap/notifications v1.2.0 (src/providers/telegram/telegram.connector.ts):
// a transport over the Bot API, a refusal in an answer of 200 read as one.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: an answer without the id of its message is of
// unknown delivery, as Telegram took the request, rather than a success
// with an empty id (V11, visulima `providers/chat/telegram/provider.ts`);
// media, buttons and albums are sent; and the receipt says `sent`, as
// Telegram tells a bot of no delivery.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure, noIdReceipt } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { verifyByGet } = require('../internal/verify.js');
const { createTelegramConfig } = require('./config.js');
const { classifyTelegram, createTelegramClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'telegram';

// The id of a message: that of its chat and its own, as a message_id is one
// only within its chat. The first of an album names it.
const messageIdOf = (result) => {
  const first = Array.isArray(result) ? result[0] : result;
  const messageId = first?.message_id;
  if (!Number.isSafeInteger(messageId)) return undefined;
  const chatId = first.chat?.id;
  return chatId === undefined ? String(messageId) : `${chatId}:${messageId}`;
};

const receiptOf = (json) => {
  if (json?.ok === false) {
    // A refusal Telegram gave in an answer of 200.
    const classified = classifyTelegram(json.error_code ?? 400, json) ?? {};
    return createFailedReceipt(`Telegram: ${json.description ?? 'refused'}`, {
      provider: PROVIDER,
      channel: PROVIDER,
      category: classified.category ?? 'validation',
      retryable: classified.retryable ?? false,
      code: classified.code,
      providerDetails: json,
    });
  }
  const messageId = messageIdOf(json?.result);
  if (messageId === undefined) {
    return noIdReceipt('Telegram answered without the id of the message.', PROVIDER, PROVIDER);
  }
  return { successful: true, messageId, provider: PROVIDER, channel: PROVIDER, state: 'sent' };
};

/**
 * A transport over the Bot API of Telegram (core.telegram.org/bots/api).
 */
class TelegramTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createTelegramConfig, createTelegramClient);
  }

  /**
   * Sends one message: sendMessage, the method of its medium, or
   * sendMediaGroup.
   *
   * @param message A message of Telegram.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the id of the chat and of the message as its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sent, signal) => convertMessage(sent, this.config, signal),
      request: (call, sendOptions) => this.httpClient.call(call.method, call.body, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json),
      failureOf: (error) => channelFailure(PROVIDER, PROVIDER, error),
    });
  }

  /**
   * Checks the token with getMe.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Telegram refuses the token.
   */
  verify(options) {
    return verifyByGet(this, 'Telegram', this.httpClient.urlOf('getMe'), options);
  }
}

module.exports = { TelegramTransport };
