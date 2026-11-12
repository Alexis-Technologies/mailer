// Not ported: the data of a job as the worker reads it: from a store that
// whoever can write to it may have written, so its shape is checked, and its
// hash, which holds the job to what was enqueued.

const { QueueError, invalidJob: invalid } = require('./errors.js');
const { hashJson } = require('../internal/canonical-json.js');
const { UNHASHED } = require('./job.js');
const { keyringOf, verifyJob } = require('./signing.js');
const { isObject } = require('./stored.js');
const { LATEST_VERSION, strategyOfData } = require('./strategies.js');

// The strings of every job, and those every job needs.
const STRINGS = [
  'idempotencyKey',
  'correlationId',
  'hash',
  'enqueuedAt',
  'locale',
  'tenantId',
  'notBefore',
  'expiresAt',
  'mac',
  'kid',
  'trace',
];
const REQUIRED = ['correlationId', 'hash', 'enqueuedAt'];

const checkStrings = (data, names) => {
  for (const name of names) {
    if (data[name] !== undefined && typeof data[name] !== 'string') {
      throw invalid(`${name} is no string.`);
    }
  }
};

const checkRequired = (data, names) => {
  for (const name of names) {
    if (data[name] === undefined) throw invalid(`it has no ${name}.`);
  }
};

const checkBody = (data) => {
  if (data.kind === 'template') {
    if (typeof data.template !== 'string') throw invalid('a template job names no template.');
    if (!isObject(data.context)) throw invalid('context is no object.');
    return;
  }
  if (data.kind !== 'content') throw invalid(`its kind is ${JSON.stringify(data.kind)}.`);
};

// The strategy of a version this worker reads; a later one waits for its
// worker.
const strategyOf = (data) => {
  const strategy = strategyOfData(data);
  if (strategy !== undefined) return strategy;
  if (Number.isInteger(data.v) && data.v > LATEST_VERSION) {
    throw new QueueError(
      'queue.unsupported_version',
      `The job is of version ${data.v}, which this worker does not read: it reads up to ${LATEST_VERSION}.`,
    );
  }
  throw invalid(`its version is ${JSON.stringify(data.v)}.`);
};

/**
 * Checks the data of a job as read from its queue.
 *
 * @param data The data of the job.
 * @param options `signingKeys`: a job must then be signed by one of them.
 * @returns The same data, checked.
 * @throws {QueueError} `queue.invalid_job` if it is not the data of a
 * job, `queue.unsupported_version` if a later version wrote it (its
 * version, or a field this one does not know), `queue.hash_mismatch` if it is
 * not what was enqueued, and `queue.signature_invalid` if it is not signed by
 * a key of `signingKeys`.
 * @throws {TypeError} If a signing key is invalid.
 */
const parseJob = (data, options = {}) => {
  const keyring = keyringOf(options.signingKeys);
  if (!isObject(data)) throw invalid('its data is no object.');
  // Fields it inherited would be read as its own, though the hash and the
  // MAC read its own keys alone.
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid('its data inherits fields of another object.');
  }
  if (typeof data.enc === 'string') {
    throw new QueueError(
      'queue.codec_missing',
      'The job is sealed: open it with its codec before it is read.',
    );
  }
  const strategy = strategyOf(data);
  // A field this version does not know was written by a later one: the job
  // waits for its worker, rather than failing here for a hash of other fields.
  for (const key of Object.keys(data)) {
    if (!strategy.keys.has(key)) {
      throw new QueueError(
        'queue.unsupported_version',
        `The job holds the field ${JSON.stringify(key)}, which this worker does not read.`,
      );
    }
  }
  checkBody(data);
  strategy.check(data);
  checkStrings(data, STRINGS);
  checkStrings(data, strategy.strings);
  checkRequired(data, strategy.required);
  checkRequired(data, REQUIRED);
  if (!isObject(data.metadata)) throw invalid('metadata is no object.');
  if (hashJson(data, UNHASHED) !== data.hash) {
    throw new QueueError(
      'queue.hash_mismatch',
      'The job is not what was enqueued: its hash differs.',
    );
  }
  if (keyring !== undefined) verifyJob(data, keyring, UNHASHED);
  return data;
};

module.exports = { parseJob };
