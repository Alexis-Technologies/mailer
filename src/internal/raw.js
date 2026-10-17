// Not ported: the bytes of a raw message for an HTTP API that takes it whole,
// read once and checked as the SMTP transport checks it.

const {
  createRawMessagePlan,
  iterateRawMessage,
  RawMessageValidationError,
} = require('../core/raw-message.js');
const { toAsciiAddress } = require('../core/address.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { joinChunks } = require('./body.js');

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Reads a raw message into one buffer, its lines checked as they are read,
 * and its envelope with domains as A-labels.
 *
 * @param message The raw message.
 * @param signal Cancels the read.
 * @returns `{ envelope, bytes }`.
 * @throws {RawMessageValidationError} If the envelope or the content is
 * invalid.
 * @internal
 */
const readRawMessage = async (message, signal) => {
  const plan = createRawMessagePlan(message);
  const chunks = [];
  let size = 0;
  for await (const chunk of iterateRawMessage(plan, { signal })) {
    // A chunk is valid until the next read.
    const copy = chunk.slice();
    chunks.push(copy);
    size += copy.length;
  }
  const to = [];
  for (let i = 0; i < plan.envelope.to.length; i++) to.push(toAsciiAddress(plan.envelope.to[i]));
  const from = plan.envelope.from == null ? null : toAsciiAddress(plan.envelope.from);
  return { envelope: { from, to }, bytes: joinChunks(chunks, size) };
};

/**
 * The receipt of a raw message that is invalid, or `undefined` for another
 * error.
 *
 * @param provider The transport.
 * @param error What was thrown.
 * @returns A non-retryable `validation` receipt, or `undefined`.
 * @internal
 */
const rawMessageFailure = (provider, error) =>
  error instanceof RawMessageValidationError
    ? createFailedReceipt(error.message, { provider, category: 'validation', retryable: false })
    : undefined;

/**
 * The text of a raw message, for an API that takes it as a JSON string.
 *
 * @param bytes The bytes of the message.
 * @param label The provider's name, for the error.
 * @returns The text.
 * @throws {RawMessageValidationError} If the bytes are not UTF-8.
 * @internal
 */
const rawMessageText = (bytes, label) => {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new RawMessageValidationError(`${label} takes a raw message only as UTF-8.`, 'content');
  }
};

module.exports = { rawMessageFailure, rawMessageText, readRawMessage };
