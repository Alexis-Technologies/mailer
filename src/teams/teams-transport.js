// Ported from @thinwrap/notifications v1.2.0 (src/providers/ms-teams/ms-teams.connector.ts):
// the receipt of a post to a webhook of Teams: a 202 of Workflows, and the
// `1` or the error of an Office 365 connector in its 200.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: a 202 is `accepted`, as a flow posts the card after
// it answered, where thinwrap made it sent (T9); a 200 of a connector that
// says neither `1` nor an error is of unknown delivery; and a message with
// `to` goes to the conversation of a bot, the id of its activity the id of
// the receipt.

const { generateId } = require('../core/id.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure, InvalidMessageError } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { createTeamsConfig } = require('./config.js');
const { classifyWebhook, createTeamsClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'teams';
const EMBEDDED_ERROR = /HTTP error (\d{3})/i;

const isConnectorHost = (webhookUrl) => {
  const host = new URL(webhookUrl).hostname.toLowerCase();
  return host === 'outlook.office.com' || host.endsWith('.webhook.office.com');
};

const failed = (message, fields) =>
  createFailedReceipt(message, { provider: PROVIDER, channel: 'teams', ...fields });

const success = (messageId, state) => ({
  successful: true,
  messageId,
  provider: PROVIDER,
  channel: 'teams',
  state,
});

/**
 * A transport of messages of Teams: to a channel through a webhook of
 * Workflows, or to a conversation through a bot of the Bot Framework.
 */
class TeamsTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createTeamsConfig, createTeamsClient);
  }

  #webhookReceiptOf(answer) {
    const id = () => `webhook:${generateId('message-id', this.config.generateId)}`;
    if (answer.status === 202) return success(id(), 'accepted');
    const text = answer.text.trim();
    const embedded = EMBEDDED_ERROR.exec(text);
    if (embedded !== null) {
      return failed(`Teams: ${text.slice(0, 200)}`, classifyWebhook(Number(embedded[1]), text));
    }
    if (isConnectorHost(this.config.webhookUrl) && text !== '1') {
      return failed('Teams answered the post with neither 1 nor an error.', {
        category: 'unknown',
        deliveryUnknown: true,
      });
    }
    return success(id(), 'sent');
  }

  /**
   * Posts one message.
   *
   * @param message A message of Teams.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the id of the activity of a bot its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sentMessage) => {
        const converted = convertMessage(sentMessage);
        if (converted.toWebhook && this.config.webhookUrl === undefined) {
          throw new InvalidMessageError(
            'Teams: a message without `to` goes to the webhook, and the transport has no webhookUrl.',
          );
        }
        if (!converted.toWebhook) {
          if (this.config.bot === undefined) {
            throw new InvalidMessageError(
              'Teams: a message to a conversation goes through a bot, and the transport has no bot.',
            );
          }
          if (!this.httpClient.isServiceUrl(sentMessage.to.serviceUrl)) {
            throw new InvalidMessageError(
              'Teams: the serviceUrl is none of Teams, nor of serviceUrls: the token of the bot does not go to it.',
            );
          }
        }
        converted.to = sentMessage.to;
        return converted;
      },
      request: (converted, sendOptions) =>
        converted.toWebhook
          ? this.httpClient.postWebhook(converted.body, sendOptions)
          : this.httpClient.post(converted.to, converted.body, sendOptions),
      receiptOf: (answer) => {
        if (answer.text !== undefined) return this.#webhookReceiptOf(answer);
        const id = answer.json?.id;
        if (typeof id !== 'string' || id === '') {
          return failed('Teams answered without the id of the activity.', {
            category: 'unknown',
            deliveryUnknown: true,
          });
        }
        return success(id, 'sent');
      },
      failureOf: (error) => channelFailure(PROVIDER, PROVIDER, error),
    });
  }
}

module.exports = { TeamsTransport };
