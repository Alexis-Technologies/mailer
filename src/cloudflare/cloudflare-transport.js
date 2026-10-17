// Ported from unemail v0.7.0 (src/drivers/cloudflare-email-rest.ts): a
// transport over the Email Service API of Cloudflare, which answers with the
// outcome of each recipient.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the id of a receipt is the `message_id` of the
// answer, where unemail made one of the delivered addresses and the clock,
// which carried the recipients into every log of the receipt and two sends
// in one millisecond could share; recipients that bounced or were
// suppressed are listed on a successful receipt, which fails only when none
// was accepted; `sendRaw` goes through `send_raw`; and `verify` checks the
// token.

const { generateId } = require('../core/id.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { sendConcurrently } = require('../internal/batch.js');
const { isCallerAbort, providerFailure, ProviderApiError } = require('../internal/api.js');
const { rawMessageFailure, readRawMessage } = require('../internal/raw.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { createCloudflareConfig } = require('./config.js');
const { createCloudflareClient, errorCodeOf } = require('./http-client.js');
const { convertMessage, convertRawMessage } = require('./message-converter.js');

const listOf = (value) => (Array.isArray(value) ? value : []);

/**
 * The receipt of `{ success, errors, result: { message_id, delivered,
 * queued, permanent_bounces, suppressed_recipients } }`.
 */
const receiptOf = (json, config) => {
  // A 200 with `success: false` is a request Cloudflare read but did not act on.
  if (json?.success === false) {
    const first = Array.isArray(json.errors) ? json.errors[0] : undefined;
    return createFailedReceipt(`Cloudflare: ${first?.message ?? 'the send failed.'}`, {
      provider: 'cloudflare',
      category: 'validation',
      retryable: false,
      code: errorCodeOf(json),
      providerDetails: json,
    });
  }
  const result = json?.result ?? {};
  const accepted = listOf(result.delivered).length + listOf(result.queued).length;
  const bounced = listOf(result.permanent_bounces);
  const suppressed = listOf(result.suppressed_recipients);
  if (accepted === 0) {
    const refused = bounced.length + suppressed.length > 0;
    return createFailedReceipt(
      refused
        ? 'Cloudflare: every recipient bounced permanently or is suppressed.'
        : 'Cloudflare accepted no recipient.',
      refused
        ? {
            provider: 'cloudflare',
            category: 'rejected',
            retryable: false,
            code: 'cloudflare.no_recipient_accepted',
            providerDetails: result,
          }
        : { provider: 'cloudflare', deliveryUnknown: true },
    );
  }
  const messageId =
    typeof result.message_id === 'string' && result.message_id !== ''
      ? result.message_id
      : generateId('receipt-id', config.generateId);
  const receipt = { successful: true, messageId, provider: 'cloudflare' };
  if (bounced.length > 0) receipt.bouncedRecipients = bounced;
  if (suppressed.length > 0) receipt.suppressedRecipients = suppressed;
  return receipt;
};

/**
 * A transport over the Email Service API of Cloudflare.
 */
class CloudflareTransport {
  id = 'cloudflare';

  constructor(config) {
    this.config = createCloudflareConfig(config);
    this.httpClient = createCloudflareClient(this.config);
  }

  toJSON() {
    return redactSecrets(this);
  }

  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Sends one message with `email/sending/send`.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, with the `message_id` of the answer.
   * @throws The reason of the signal if it aborts.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    try {
      const payload = await convertMessage(message, options?.signal);
      options?.signal?.throwIfAborted();
      return receiptOf((await this.httpClient.send(payload, options)).json, this.config);
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return providerFailure('cloudflare', error);
    }
  }

  /**
   * Sends a ready MIME message with `email/sending/send_raw`, to the
   * recipients of its envelope.
   *
   * @param message The raw message; its bytes must be UTF-8.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt.
   * @throws The reason of the signal if it aborts.
   */
  async sendRaw(message, options) {
    if (message?.content instanceof Promise) message.content.catch(() => {});
    options?.signal?.throwIfAborted();
    try {
      const payload = convertRawMessage(await readRawMessage(message, options?.signal));
      return receiptOf((await this.httpClient.sendRaw(payload, options)).json, this.config);
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return rawMessageFailure('cloudflare', error) ?? providerFailure('cloudflare', error);
    }
  }

  /**
   * Sends messages `concurrency` at a time, the receipts in their order.
   */
  sendMany(messages, options) {
    return sendConcurrently(
      messages,
      this.config.concurrency,
      (message) => this.send(message, options),
      options?.signal,
    );
  }

  /**
   * Verifies the API token with Cloudflare's own check, as a token of the
   * account and, failing that, of a user.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Cloudflare refuses the token, finds it inactive, or
   * cannot be reached.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    const check = async (url) => {
      const answer = await this.httpClient.request({
        url,
        method: 'GET',
        isIdempotent: true,
        signal: options?.signal,
      });
      const status = answer.json?.result?.status;
      if (status !== 'active') {
        throw new Error(`Cloudflare: the API token is ${String(status ?? 'not active')}.`);
      }
    };
    try {
      await check(`${this.httpClient.account}/tokens/verify`);
    } catch (error) {
      // A token of a user is not one of the account.
      const status = error instanceof ProviderApiError ? error.statusCode : undefined;
      if (status === undefined || status >= 500) throw error;
      await check(`${this.config.baseUrl}/user/tokens/verify`);
    }
  }
}

module.exports = { CloudflareTransport };
