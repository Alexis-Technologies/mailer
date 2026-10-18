// Ported from unemail v0.7.0 (src/drivers/mailjet.ts): a transport over the
// Mailjet Send API v3.1, whose `Messages` are its batch, each with its own
// answer, a 400 carrying the answers of those that went too.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: requests are split by the recipients they carry, as
// unemail split them, while the input is read a batch at a time, and a
// message that cannot be converted fails alone.

const { generateId } = require('../core/id.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { chunks, jsonBytes } = require('../internal/batch.js');
const {
  ProviderApiError,
  convertBatch,
  isCallerAbort,
  mergeBatch,
  providerFailure,
} = require('../internal/api.js');
const { verifyByGet } = require('../internal/verify.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { createMailjetConfig } = require('./config.js');
const { createMailjetClient } = require('./http-client.js');
const { MAX_RECIPIENTS, convertMessage, recipientCount } = require('./message-converter.js');

// Mailjet takes 15 MB a request at most, attachments included.
const MAX_REQUEST_BYTES = 15 * 1000 * 1000;

// Mailjet names every problem of a message at once, with the fields it is
// about.
const describeErrors = (errors) => {
  let text = '';
  for (const error of errors) {
    const message = error?.ErrorMessage ?? error?.ErrorCode ?? '';
    const related = Array.isArray(error?.ErrorRelatedTo) ? error.ErrorRelatedTo : [];
    let part = message;
    if (related.length > 0) part = `${related.join(', ')}: ${message}`;
    if (part !== '') text += text === '' ? part : `; ${part}`;
  }
  return text;
};

// The answers of a request, from a 2xx or from the 400 Mailjet gives when one
// message of the request failed.
const answersOf = (error) =>
  error instanceof ProviderApiError &&
  error.statusCode === 400 &&
  Array.isArray(error.providerDetails?.Messages)
    ? error.providerDetails.Messages
    : undefined;

/**
 * A transport over the Send API v3.1 of Mailjet.
 */
class MailjetTransport {
  id = 'mailjet';

  constructor(config) {
    this.config = createMailjetConfig(config);
    this.httpClient = createMailjetClient(this.config);
  }

  toJSON() {
    return redactSecrets(this);
  }

  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  receiptOf(entry) {
    if (entry?.Status !== 'success') {
      const errors = Array.isArray(entry?.Errors) ? entry.Errors : [];
      const text = describeErrors(errors) || `message status "${entry?.Status ?? 'unknown'}"`;
      return createFailedReceipt(`Mailjet: ${text}`, {
        provider: 'mailjet',
        statusCode: errors[0]?.StatusCode,
        code: errors[0]?.ErrorCode == null ? undefined : `mailjet.${errors[0].ErrorCode}`,
        deliveryUnknown: entry == null,
        providerDetails: entry ?? undefined,
      });
    }
    const recipient = entry.To?.[0] ?? entry.Cc?.[0] ?? entry.Bcc?.[0];
    let messageId =
      recipient?.MessageUUID || (recipient?.MessageID ? String(recipient.MessageID) : '');
    // The sandbox checks and drops a message: it has no id of its own.
    if (messageId === '' && this.config.sandbox) {
      messageId = `sandbox-${generateId('receipt-id', this.config.generateId)}`;
    }
    if (messageId === '') {
      return createFailedReceipt('Mailjet answered without a MessageUUID.', {
        provider: 'mailjet',
        deliveryUnknown: true,
      });
    }
    return { successful: true, messageId, provider: 'mailjet' };
  }

  // Sends entries in one request: the receipt of each, or the failure of all.
  async sendEntries(entries, options) {
    let answers;
    try {
      const answer = await this.httpClient.send(entries, options);
      answers = Array.isArray(answer.json?.Messages) ? answer.json.Messages : [];
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      answers = answersOf(error);
      if (answers === undefined) {
        const failure = providerFailure('mailjet', error);
        const receipts = [];
        for (let i = 0; i < entries.length; i++) receipts.push(failure);
        return receipts;
      }
    }
    const receipts = [];
    for (let i = 0; i < entries.length; i++) receipts.push(this.receiptOf(answers[i]));
    return receipts;
  }

  /**
   * Sends one message.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, with the MessageUUID of the first recipient.
   * @throws The reason of the signal if it aborts.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    try {
      const entry = await convertMessage(message, this.config, options?.signal);
      options?.signal?.throwIfAborted();
      return (await this.sendEntries([entry], options))[0];
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return providerFailure('mailjet', error);
    }
  }

  /**
   * Sends messages in requests of up to 50 recipients and 15 MB, each message
   * with the receipt of its own answer.
   *
   * @param messages The messages.
   * @param options Optional abort signal and retry callback.
   * @returns The receipts, in the order of the messages.
   */
  async *sendMany(messages, options) {
    const signal = options?.signal;
    for await (const batch of chunks(messages, MAX_RECIPIENTS)) {
      signal?.throwIfAborted();
      const converted = await convertBatch(
        batch,
        (message) => convertMessage(message, this.config, signal),
        'mailjet',
        signal,
      );
      const receipts = [];
      let run = [];
      let recipients = 0;
      let bytes = 16;
      for (let i = 0; i < batch.length; i++) {
        if (typeof converted.slots[i] !== 'number') continue;
        const count = recipientCount(batch[i]);
        const entry = converted.payloads[converted.slots[i]];
        const size = jsonBytes(entry);
        const full = recipients + count > MAX_RECIPIENTS || bytes + size > MAX_REQUEST_BYTES;
        if (run.length > 0 && full) {
          for (const receipt of await this.sendEntries(run, options)) receipts.push(receipt);
          run = [];
          recipients = 0;
          bytes = 16;
        }
        run.push(entry);
        recipients += count;
        bytes += size;
      }
      if (run.length > 0) {
        for (const receipt of await this.sendEntries(run, options)) receipts.push(receipt);
      }
      yield* mergeBatch(converted.slots, (index) => receipts[index]);
    }
  }

  /**
   * Verifies the key pair by reading its profile (`GET /v3/REST/myprofile`).
   *
   * @param options Optional abort signal.
   * @throws {Error} If Mailjet refuses the keys or cannot be reached.
   */
  verify(options) {
    return verifyByGet(this, 'Mailjet', `${this.config.baseUrl}/v3/REST/myprofile`, options);
  }
}

module.exports = { MailjetTransport };
