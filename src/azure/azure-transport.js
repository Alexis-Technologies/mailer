// Ported from unemail v0.7.0 (src/drivers/azure-communication.ts): a transport
// over the Email API of Azure Communication Services, whose send is a
// long-running operation it accepts with a 202.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a repeat Azure answers with 409 (the first request
// still running) or 412 (after the first, outside the five minutes it
// tracks) is a delivery of unknown outcome, not a failure to send again; and
// `verify` reads an operation that does not exist.

const { generateId } = require('../core/id.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { sendConcurrently } = require('../internal/batch.js');
const { isCallerAbort, providerFailure } = require('../internal/api.js');
const { toUuid } = require('../internal/uuid.js');
const { verifyByRequest } = require('../internal/verify.js');
const { createAzureConfig } = require('./config.js');
const { createAzureClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');
const { ProviderTransport } = require('../internal/provider-transport.js');

// The id of no operation, which `verify` reads.
const NO_OPERATION = '00000000-0000-0000-0000-000000000000';
const FAILED_STATES = new Set(['Failed', 'Canceled']);

const failureOf = (error) => {
  const repeated = error?.statusCode === 409 || (error?.statusCode === 412 && error.attempts > 1);
  if (repeated) {
    // Azure took this request before: it is running, or went then.
    return createFailedReceipt(`${error.message} (a repeat of a request Azure took before)`, {
      provider: 'azure',
      category: 'unknown',
      deliveryUnknown: true,
      statusCode: error.statusCode,
      attempts: error.attempts,
      code: error.receiptCode,
    });
  }
  return providerFailure('azure', error);
};

const receiptOf = (answer, requestId) => {
  const json = answer.json ?? {};
  if (FAILED_STATES.has(json.status)) {
    const detail = json.error?.message ?? json.status;
    return createFailedReceipt(`Azure Communication Services: ${detail}`, {
      provider: 'azure',
      category: 'rejected',
      retryable: false,
      code: typeof json.error?.code === 'string' ? `azure.${json.error.code}` : undefined,
      providerDetails: json,
    });
  }
  const messageId = typeof json.id === 'string' && json.id !== '' ? json.id : requestId;
  return { successful: true, messageId, provider: 'azure' };
};

/**
 * A transport over the Email API of Azure Communication Services.
 */
class AzureTransport extends ProviderTransport {
  constructor(config) {
    super('azure', config, createAzureConfig, createAzureClient);
  }

  /**
   * Sends one message with `emails:send`.  Its `idempotencyKey`, or one made
   * for this send, is the id of the operation and of its repeats, so a
   * retry within five minutes is answered with the outcome of the first.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, with the id of the operation.
   * @throws The reason of the signal if it aborts.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    try {
      const payload = await convertMessage(message, this.config, options?.signal);
      options?.signal?.throwIfAborted();
      const requestId = toUuid(
        message.idempotencyKey ?? generateId('idempotency-key', this.config.generateId),
      );
      const firstSent = new Date(this.config.now());
      const answer = await this.httpClient.send(payload, requestId, firstSent, options);
      return receiptOf(answer, requestId);
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return failureOf(error);
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
   * Verifies the access key by reading an operation that does not exist: a
   * request Azure authenticates is answered 404, one it does not 401.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Azure refuses the key or cannot be reached.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    const { endpoint, apiVersion } = this.config;
    await verifyByRequest({
      provider: 'Azure Communication Services',
      send: (signal) =>
        this.httpClient.fetchWithAuth(
          `${endpoint}/emails/operations/${NO_OPERATION}?api-version=${apiVersion}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
          signal,
        ),
      check: (status) => status === 404,
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      signal: options?.signal,
      log: this.httpClient.log,
    });
  }
}

module.exports = { AzureTransport };
