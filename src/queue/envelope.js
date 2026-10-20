// Not ported: the data of a job sealed by a codec of the application's, such
// as an envelope encryption under its key or KMS. The store then holds what
// the codec made of the fields of the message, its addresses, context and
// attachments, and in clear only what a driver and a dashboard read: the
// version, the hash by which a duplicate is told, the signature and the trace
// context.

const { messageOf } = require('../internal/decorator.js');
const { MailQueueError } = require('./errors.js');

// The fields a sealed job keeps in clear, beside `enc`: an id of its message
// among them, by which a driver that gives a job up tells the audit.
const ENVELOPE = new Set(['v', 'hash', 'enqueuedAt', 'correlationId', 'mac', 'kid', 'trace']);

/**
 * Checks a codec: `encode(text)` and `decode(text)`, sync or async, each
 * giving a string.
 *
 * @param codec The codec, or nothing.
 * @returns The codec.
 * @throws {TypeError} If it is not one.
 * @internal
 */
const checkCodec = (codec) => {
  if (codec === undefined) return undefined;
  if (typeof codec?.encode !== 'function' || typeof codec?.decode !== 'function') {
    throw new TypeError('codec must have encode(text) and decode(text).');
  }
  return codec;
};

/**
 * Whether the data of a job is sealed.
 *
 * @internal
 */
const isSealed = (data) =>
  typeof data === 'object' && data !== null && typeof data.enc === 'string';

/**
 * Seals the data of a job: the fields of its message as the codec encodes
 * their JSON, the envelope in clear.
 *
 * @param data The data of the job, its hash and signature made.
 * @param codec The codec.
 * @returns The sealed data.
 * @throws {TypeError} If the codec gives no string.
 * @internal
 */
const sealMailJob = async (data, codec) => {
  const envelope = {};
  const fields = {};
  for (const key of Object.keys(data)) {
    if (ENVELOPE.has(key)) envelope[key] = data[key];
    else fields[key] = data[key];
  }
  const enc = await codec.encode(JSON.stringify(fields));
  if (typeof enc !== 'string' || enc === '') {
    throw new TypeError('codec.encode must give a string.');
  }
  envelope.enc = enc;
  return envelope;
};

const invalid = (message) => new MailQueueError('queue.invalid_job', `Invalid job: ${message}`);

/**
 * Opens the data of a job read from its store: sealed data as the codec
 * decodes it, unsealed data as it is.
 *
 * @param data The data of the job.
 * @param codec The codec, if any.
 * @returns The data in clear, to be checked by `parseMailJob`.
 * @throws {MailQueueError} `queue.codec_missing` for sealed data and no
 * codec; `queue.codec_failed` if the codec throws, with its error as
 * `cause`; `queue.invalid_job` if what it gives is not the fields of a job.
 * @internal
 */
const openMailJob = async (data, codec) => {
  if (!isSealed(data)) return data;
  if (codec === undefined) {
    throw new MailQueueError(
      'queue.codec_missing',
      'The job is sealed, and this worker has no codec to open it.',
    );
  }
  let text;
  try {
    text = await codec.decode(data.enc);
  } catch (error) {
    throw new MailQueueError(
      'queue.codec_failed',
      `The codec could not open the job: ${messageOf(error)}`,
      { cause: error },
    );
  }
  let fields;
  try {
    fields = JSON.parse(text);
  } catch {
    throw invalid('the codec gave no JSON.');
  }
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw invalid('the codec gave no object.');
  }
  const opened = {};
  for (const key of Object.keys(fields)) {
    if (ENVELOPE.has(key) || key === 'enc') throw invalid(`its sealed fields hold ${key}.`);
    opened[key] = fields[key];
  }
  // A field in clear beside `enc` would stand over the sealed one.
  for (const key of Object.keys(data)) {
    if (key === 'enc') continue;
    if (!ENVELOPE.has(key)) throw invalid(`a sealed job holds ${key} in clear.`);
    opened[key] = data[key];
  }
  return opened;
};

module.exports = { checkCodec, openMailJob, sealMailJob };
