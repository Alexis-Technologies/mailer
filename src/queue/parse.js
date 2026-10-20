// Not ported: the data of a job as the worker reads it: from a store that
// whoever can write to it may have written, so its shape is checked, and its
// hash, which holds the job to what was enqueued.

const { MailQueueError } = require('./errors.js');
const { hashJson } = require('./hash.js');
const { MAIL_JOB_VERSION, UNHASHED, V1_KEYS } = require('./job.js');
const { keyringOf, verifyJob } = require('./signing.js');

const invalid = (message) => new MailQueueError('queue.invalid_job', `Invalid job: ${message}`);

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const checkAddress = (value, name) => {
  if (!isObject(value) || typeof value.address !== 'string') {
    throw invalid(`${name} is no address.`);
  }
};

const checkAddresses = (value, name, required) => {
  if (value === undefined && !required) return;
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw invalid(`${name} is no list of addresses.`);
  }
  for (const address of value) checkAddress(address, name);
};

const checkStrings = (data, names) => {
  for (const name of names) {
    if (data[name] !== undefined && typeof data[name] !== 'string') {
      throw invalid(`${name} is no string.`);
    }
  }
};

const checkBody = (data) => {
  if (data.kind === 'template') {
    if (typeof data.template !== 'string') throw invalid('a template job names no template.');
    if (!isObject(data.context)) throw invalid('context is no object.');
    return;
  }
  if (data.kind !== 'content') throw invalid(`its kind is ${JSON.stringify(data.kind)}.`);
  if (typeof data.subject !== 'string' || !isObject(data.content)) {
    throw invalid('a content job has no subject or content.');
  }
};

const checkAttachments = (attachments) => {
  if (attachments === undefined) return;
  if (!Array.isArray(attachments)) throw invalid('attachments is no list.');
  for (const attachment of attachments) {
    if (
      !isObject(attachment) ||
      typeof attachment.filename !== 'string' ||
      typeof attachment.contentType !== 'string' ||
      typeof attachment.contentId !== 'string' ||
      typeof attachment.inline !== 'boolean' ||
      (typeof attachment.data === 'string') === (typeof attachment.ref === 'string')
    ) {
      throw invalid(
        'an attachment is not { filename, contentType, inline, contentId, data | ref }.',
      );
    }
  }
};

/**
 * Checks the data of a job as read from its queue.
 *
 * @param data The data of the job.
 * @param options `signingKeys`: a job must then be signed by one of them.
 * @returns The same data, checked.
 * @throws {MailQueueError} `queue.invalid_job` if it is not the data of a
 * mail job, `queue.unsupported_version` if a later version wrote it (its
 * version, or a field this one does not know), `queue.hash_mismatch` if it is
 * not what was enqueued, and `queue.signature_invalid` if it is not signed by
 * a key of `signingKeys`.
 * @throws {TypeError} If a signing key is invalid.
 */
const parseMailJob = (data, options = {}) => {
  const keyring = keyringOf(options.signingKeys);
  if (!isObject(data)) throw invalid('its data is no object.');
  if (typeof data.enc === 'string') {
    throw new MailQueueError(
      'queue.codec_missing',
      'The job is sealed: open it with its codec before it is read.',
    );
  }
  if (data.v !== MAIL_JOB_VERSION) {
    if (Number.isInteger(data.v) && data.v > MAIL_JOB_VERSION) {
      throw new MailQueueError(
        'queue.unsupported_version',
        `The job is of version ${data.v}, which this worker does not read: it reads ${MAIL_JOB_VERSION}.`,
      );
    }
    throw invalid(`its version is ${JSON.stringify(data.v)}.`);
  }
  // A field this version does not know was written by a later one: the job
  // waits for its worker, rather than failing here for a hash of other fields.
  for (const key of Object.keys(data)) {
    if (!V1_KEYS.has(key)) {
      throw new MailQueueError(
        'queue.unsupported_version',
        `The job holds the field ${JSON.stringify(key)}, which this worker does not read.`,
      );
    }
  }
  checkBody(data);
  checkAddress(data.from, 'from');
  checkAddresses(data.to, 'to', true);
  checkAddresses(data.cc, 'cc', false);
  checkAddresses(data.bcc, 'bcc', false);
  checkAddresses(data.replyTo, 'replyTo', false);
  checkAttachments(data.attachments);
  checkStrings(data, ['idempotencyKey', 'messageId', 'correlationId', 'hash', 'enqueuedAt']);
  checkStrings(data, ['subject', 'locale', 'tenantId', 'date', 'notBefore', 'expiresAt']);
  checkStrings(data, ['mac', 'kid', 'trace']);
  for (const name of ['messageId', 'correlationId', 'hash', 'enqueuedAt']) {
    if (data[name] === undefined) throw invalid(`it has no ${name}.`);
  }
  if (!isObject(data.metadata)) throw invalid('metadata is no object.');
  if (hashJson(data, UNHASHED) !== data.hash) {
    throw new MailQueueError(
      'queue.hash_mismatch',
      'The job is not what was enqueued: its hash differs.',
    );
  }
  if (keyring !== undefined) verifyJob(data, keyring, UNHASHED);
  return data;
};

module.exports = { parseMailJob };
