// Not ported: a transport of Discord over the REST API of a bot and over a
// webhook: the wait for the bucket of a route before a send, and the receipt
// of the message Discord created, its snowflake the id.

const { createFailedReceipt } = require('../core/receipt.js');
const { ProviderApiError } = require('../internal/api-client.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { RefusalError } = require('../internal/refusal.js');
const { sleep } = require('../internal/sleep.js');
const { verifyByGet } = require('../internal/verify.js');
const { createDiscordConfig } = require('./config.js');
const { createDiscordClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'discord';
// The longest a send waits for its bucket; past it, the receipt tells the
// wait, for the caller or a queue to schedule.
const MAX_BUCKET_WAIT_MS = 30_000;

const receiptOf = (json) => {
  if (typeof json?.id !== 'string' || json.id === '') {
    return createFailedReceipt('Discord answered without the id of the message.', {
      provider: PROVIDER,
      channel: PROVIDER,
      category: 'unknown',
      deliveryUnknown: true,
      deliveryUnknownReason: 'no-id',
    });
  }
  return {
    successful: true,
    messageId: json.id,
    provider: PROVIDER,
    channel: PROVIDER,
    state: 'sent',
  };
};

/**
 * A transport of Discord: a message with `to` (a channel) through the REST
 * API of a bot, one without it through the webhook.
 */
class DiscordTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createDiscordConfig, createDiscordClient);
  }

  #urlOf(converted) {
    if (!converted.toWebhook) return this.httpClient.channelUrl(converted.channelId);
    const query = { wait: 'true' };
    if (converted.thread !== undefined) query.thread_id = converted.thread;
    // A webhook a user made sends a link button only when asked to.
    if (converted.hasButtons) query.with_components = 'true';
    return this.httpClient.webhookUrl(query);
  }

  /**
   * Sends one message, after the bucket of its route has room.
   *
   * @param message A message of Discord.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the snowflake of the message its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: async (sent, signal) => {
        const converted = await convertMessage(sent, this.config, signal);
        const credential = converted.toWebhook ? this.config.webhookUrl : this.config.botToken;
        if (credential === undefined) {
          throw new RefusalError(
            converted.toWebhook
              ? 'Discord: a message without `to` goes to the webhook, and the transport has no webhookUrl.'
              : 'Discord: a message to a channel goes through a bot, and the transport has no botToken.',
          );
        }
        return { ...converted, url: this.#urlOf(converted) };
      },
      request: async (converted, sendOptions) => {
        const route = this.httpClient.routeOf(converted.url);
        const delay = this.httpClient.buckets.delayOf(route);
        if (delay > MAX_BUCKET_WAIT_MS) {
          throw new ProviderApiError(
            PROVIDER,
            `Discord: the bucket of the route is empty for ${delay} ms.`,
            {
              retryAfterMilliseconds: delay,
              category: 'rate-limit',
              retryable: true,
              code: 'discord.bucket',
            },
          );
        }
        if (delay > 0) await sleep(delay, sendOptions?.signal);
        return converted.toWebhook
          ? this.httpClient.execute(converted.url, converted.body, sendOptions)
          : this.httpClient.create(converted.url, converted.body, sendOptions);
      },
      receiptOf: (answer) => receiptOf(answer.json),
      failureOf: (error) => channelFailure(PROVIDER, PROVIDER, error),
    });
  }

  /**
   * Checks the token of the bot by reading the bot (`/users/@me`), or the
   * webhook by reading it, which posts nothing.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Discord refuses the credential.
   */
  async verify(options) {
    if (this.config.botToken !== undefined) {
      await verifyByGet(this, 'Discord', `${this.config.baseUrl}/users/@me`, options);
    }
    if (this.config.webhookUrl !== undefined) {
      await verifyByGet(this, 'Discord', this.config.webhookUrl, options);
    }
  }
}

module.exports = { DiscordTransport };
