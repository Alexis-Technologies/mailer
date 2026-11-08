// Not ported: a transport of Slack over chat.postMessage of its Web API and
// over an incoming webhook, the receipt of each: `<channel>:<ts>` of the Web
// API, an id of the transport's own for a webhook, which names no message.
// thinwrap and visulima post to a webhook and give no id; neither reads an
// `ok: false` of the Web API by its error.

const { generateId } = require('../core/id.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { InvalidMessageError, channelFailure } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { verifyByGet } = require('../internal/verify.js');
const { createSlackConfig } = require('./config.js');
const { classifySlackError, createSlackClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'slack';

const sent = (messageId) => ({
  successful: true,
  messageId,
  provider: PROVIDER,
  channel: PROVIDER,
  state: 'sent',
});

// The receipt of an answer of chat.postMessage: `ok: false` read by its
// error, a `fatal_error` of unknown delivery, as Slack may have posted.
const apiReceiptOf = (json) => {
  if (json?.ok !== true) {
    const classified = classifySlackError(json?.error, 200);
    return createFailedReceipt(`Slack: ${json?.error ?? 'refused'}`, {
      provider: PROVIDER,
      channel: PROVIDER,
      category: classified.category,
      retryable: classified.retryable,
      code: classified.code,
      deliveryUnknown: classified.unknown,
      providerDetails: json ?? undefined,
    });
  }
  if (typeof json.ts !== 'string' || json.ts === '') {
    return createFailedReceipt('Slack answered without the ts of the message.', {
      provider: PROVIDER,
      channel: PROVIDER,
      category: 'unknown',
      deliveryUnknown: true,
    });
  }
  return sent(`${json.channel}:${json.ts}`);
};

/**
 * A transport of Slack: chat.postMessage of the Web API for a message with
 * `to`, the incoming webhook for one without.
 */
class SlackTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createSlackConfig, createSlackClient);
  }

  /**
   * Posts one message.
   *
   * @param message A message of Slack.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, `<channel>:<ts>` its id through the Web API.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sentMessage) => {
        const converted = convertMessage(sentMessage);
        const credential = converted.toWebhook ? this.config.webhookUrl : this.config.botToken;
        if (credential === undefined) {
          throw new InvalidMessageError(
            converted.toWebhook
              ? 'Slack: a message without `to` goes to the webhook, and the transport has no webhookUrl.'
              : 'Slack: a message to a channel goes through the Web API, and the transport has no botToken.',
          );
        }
        return converted;
      },
      request: (converted, sendOptions) =>
        converted.toWebhook
          ? this.httpClient.post(converted.body, sendOptions)
          : this.httpClient.call('chat.postMessage', converted.body, sendOptions),
      receiptOf: (answer) =>
        answer.text === undefined
          ? apiReceiptOf(answer.json)
          : sent(`webhook:${generateId('message-id', this.config.generateId)}`),
      failureOf: (error) => channelFailure(PROVIDER, PROVIDER, error),
    });
  }

  /**
   * Checks the token of the bot with auth.test.  A webhook cannot be
   * checked without posting to it: a transport of a webhook alone verifies
   * nothing.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Slack refuses the token.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    if (this.config.botToken === undefined) return;
    await verifyByGet(this, 'Slack', this.httpClient.urlOf('auth.test'), options, {
      init: { method: 'POST', headers: { Accept: 'application/json' } },
      check: (status, body) => {
        let json;
        try {
          json = JSON.parse(body);
        } catch {
          json = undefined;
        }
        if (status >= 200 && status <= 299 && json?.ok !== true) {
          throw Object.assign(
            new Error(`Slack refused the token: ${json?.error ?? 'no answer'}.`),
            {
              statusCode: status,
            },
          );
        }
        return false;
      },
    });
  }
}

module.exports = { SlackTransport };
