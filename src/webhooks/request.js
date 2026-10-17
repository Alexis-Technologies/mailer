// Not ported: what the webhook verifiers share — the raw body, the header
// fields of any kind of request, the error of a refusal, the window of time a
// signed request is taken in, the store of the ids already seen, and the
// shape of an event.  sently parsed a payload apart from its check; here
// nothing is read before it is verified.

const { createHmac, timingSafeEqual } = require('node:crypto');
const { checkOptionalFunction, checkPositiveNumber } = require('../internal/options.js');

const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * A request a verifier refused: `reason` says why.
 */
class WebhookVerificationError extends Error {
  /**
   * @param reason `signature`, `timestamp`, `replay`, `payload`,
   * `certificate`, `topic` or `credentials`.
   * @param message What failed.
   * @param options The cause.
   */
  constructor(reason, message, options) {
    super(message, options);
    this.name = 'WebhookVerificationError';
    this.reason = reason;
  }
}

/**
 * Makes a store of the ids of the requests already taken, in this process,
 * which holds at most `maxEntries`, the oldest dropped first.
 *
 * @param options `maxEntries` (10000) and `now`.
 * @returns `{ add(id, ttlMs) }`, true when the id is new.
 */
const createMemoryReplayStore = (options = {}) => {
  const maxEntries = options.maxEntries ?? 10000;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError(`maxEntries must be a positive integer: ${String(maxEntries)}`);
  }
  const now = checkOptionalFunction(options.now, 'now') ?? Date.now;
  const seen = new Map();
  return {
    add(id, ttlMs) {
      const at = now();
      const expiresAt = seen.get(id);
      if (expiresAt !== undefined && expiresAt > at) return false;
      seen.delete(id);
      seen.set(id, at + ttlMs);
      for (const [key, until] of seen) {
        if (seen.size <= maxEntries && until > at) break;
        seen.delete(key);
      }
      return true;
    },
  };
};

/**
 * Resolves the options every verifier takes.
 *
 * @internal
 */
const resolveCommonOptions = (options, defaultToleranceMs) => {
  const replayStore =
    options.replayStore === undefined ? createMemoryReplayStore() : options.replayStore;
  if (replayStore !== null && typeof replayStore?.add !== 'function') {
    throw new TypeError('replayStore must have an add method, or be null.');
  }
  return {
    now: checkOptionalFunction(options.now, 'now') ?? Date.now,
    toleranceMs: checkPositiveNumber(options.toleranceMs ?? defaultToleranceMs, 'toleranceMs'),
    replayStore,
    maxBodyBytes: checkPositiveNumber(
      options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      'maxBodyBytes',
    ),
  };
};

/**
 * The bytes of the raw body, which a signature covers; a parsed object
 * cannot be verified.
 *
 * @internal
 */
const bodyBytesOf = (request, common) => {
  const body = request?.body;
  let bytes;
  if (typeof body === 'string') bytes = Buffer.from(body, 'utf8');
  else if (body instanceof Uint8Array) bytes = body;
  else throw new TypeError('body must be the raw body of the request, a string or bytes.');
  if (bytes.length > common.maxBodyBytes) {
    throw new WebhookVerificationError('payload', `The body is over ${common.maxBodyBytes} bytes.`);
  }
  return bytes;
};

/**
 * The JSON of a body, read once it is verified.
 *
 * @internal
 */
const parseJsonOf = (bytes) => {
  let text;
  try {
    text = UTF8.decode(bytes);
    return JSON.parse(text);
  } catch (error) {
    throw new WebhookVerificationError('payload', 'The body is not JSON in UTF-8.', {
      cause: error,
    });
  }
};

/**
 * A header field of a fetch `Headers` or of a Node request's `headers`, its
 * name in any case; the first of several.
 *
 * @internal
 */
const headerOf = (request, name) => {
  const headers = request?.headers;
  if (headers == null) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const wanted = name.toLowerCase();
  for (const key in headers) {
    if (key.toLowerCase() !== wanted) continue;
    const value = headers[key];
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
};

/**
 * Refuses a request signed too far from now.
 *
 * @internal
 */
const checkTime = (atMs, common) => {
  if (!Number.isFinite(atMs) || Math.abs(common.now() - atMs) > common.toleranceMs) {
    throw new WebhookVerificationError(
      'timestamp',
      `The request was signed more than ${common.toleranceMs} ms from now.`,
    );
  }
};

/**
 * Refuses a request whose id was taken before.
 *
 * @internal
 */
const checkReplay = async (common, id, ttlMs = common.toleranceMs * 2) => {
  if (common.replayStore === null) return;
  // Kept for twice the window by default, so a request cannot come back in it.
  if ((await common.replayStore.add(id, ttlMs)) !== true) {
    throw new WebhookVerificationError('replay', `The request ${id} was taken before.`);
  }
};

/**
 * Compares two secrets in constant time.
 *
 * @internal
 */
const equalBytes = (a, b) => a.length === b.length && timingSafeEqual(a, b);

/**
 * A date from seconds, milliseconds or an ISO string, or `undefined`.
 *
 * @internal
 */
const dateOf = (value) => {
  let date;
  if (typeof value === 'number') date = new Date(value < 1e12 ? value * 1000 : value);
  else if (typeof value === 'string' && value !== '') {
    date = /^\d+(\.\d+)?$/.test(value) ? dateOf(Number(value)) : new Date(value);
  }
  return date !== undefined && Number.isFinite(date.getTime()) ? date : undefined;
};

const OPTIONAL_FIELDS = ['messageId', 'recipient', 'occurredAt', 'bounce', 'reason', 'url'];

/**
 * An event, its optional fields left out when absent.
 *
 * @internal
 */
const createEvent = (fields) => {
  const event = { provider: fields.provider, type: fields.type, id: fields.id };
  for (const name of OPTIONAL_FIELDS) {
    if (fields[name] !== undefined && fields[name] !== '') event[name] = fields[name];
  }
  event.tags = fields.tags ?? [];
  event.metadata = fields.metadata ?? Object.create(null);
  event.raw = fields.raw;
  return event;
};

/**
 * Whether a value is a plain record.
 *
 * @internal
 */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A string, or `undefined`.
 *
 * @internal
 */
const stringOf = (value) => (typeof value === 'string' && value !== '' ? value : undefined);

const HEX = /^[0-9a-f]+$/i;

/**
 * Checks the HMAC-SHA256 of the raw body, in hexadecimal in a header field.
 *
 * @internal
 */
const checkBodyHmac = (request, bytes, header, secret, label) => {
  const given = headerOf(request, header);
  if (given === undefined || !HEX.test(given.trim())) {
    throw new WebhookVerificationError('signature', `The request has no ${label} signature.`);
  }
  const expected = createHmac('sha256', secret).update(bytes).digest();
  if (!equalBytes(expected, Buffer.from(given.trim(), 'hex'))) {
    throw new WebhookVerificationError('signature', `The ${label} signature does not match.`);
  }
};

/**
 * The credentials a webhook URL carries (`https://user:password@…`), for a
 * provider that signs nothing.
 *
 * @internal
 */
const basicCredentialsOf = (options, label) => {
  for (const name of ['username', 'password']) {
    if (typeof options[name] !== 'string' || options[name] === '') {
      throw new TypeError(
        `${name} is required: ${label} signs nothing, so its webhook URL carries credentials.`,
      );
    }
  }
  return Buffer.from(`${options.username}:${options.password}`, 'utf8');
};

/**
 * Checks the Basic credentials of a request in constant time.
 *
 * @internal
 */
const checkBasicCredentials = (request, expected) => {
  const header = headerOf(request, 'authorization');
  const space = header === undefined ? -1 : header.indexOf(' ');
  if (space < 0 || header.slice(0, space).toLowerCase() !== 'basic') {
    throw new WebhookVerificationError('credentials', 'The request has no Basic credentials.');
  }
  const given = Buffer.from(header.slice(space + 1).trim(), 'base64');
  if (!equalBytes(given, expected)) {
    throw new WebhookVerificationError('credentials', 'The credentials do not match.');
  }
};

/**
 * The string values of a record, numbers and booleans as text.
 *
 * @internal
 */
const stringRecordOf = (values) => {
  const record = Object.create(null);
  if (!isRecord(values)) return record;
  for (const name in values) {
    const value = values[name];
    if (typeof value === 'string') record[name] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') record[name] = String(value);
  }
  return record;
};

/**
 * The strings of a list.
 *
 * @internal
 */
const stringsOf = (list) => {
  const strings = [];
  if (!Array.isArray(list)) return strings;
  for (const item of list) {
    if (typeof item === 'string' && item !== '') strings.push(item);
  }
  return strings;
};

/**
 * A record of JSON text, such as metadata a provider keeps as one string.
 *
 * @internal
 */
const jsonRecordOf = (text) => {
  if (typeof text !== 'string' || text === '') return Object.create(null);
  try {
    return stringRecordOf(JSON.parse(text));
  } catch {
    return Object.create(null);
  }
};

const METADATA_HEADER = /^x-metadata-(.+)$/i;

/**
 * The metadata the transports send as `X-Metadata-<key>` header fields, from
 * the headers an event carries: a record, or a list of `{ name | key, value }`.
 *
 * @internal
 */
const metadataFromHeaders = (headers) => {
  const metadata = Object.create(null);
  const add = (name, value) => {
    const match = typeof name === 'string' ? METADATA_HEADER.exec(name) : null;
    if (match !== null && typeof value === 'string') metadata[match[1]] = value;
  };
  if (Array.isArray(headers)) {
    for (const header of headers) add(header?.name ?? header?.key, header?.value);
  } else if (isRecord(headers)) {
    for (const name in headers) add(name, headers[name]);
  }
  return metadata;
};

/**
 * Checks the token a webhook is configured with: `Authorization: Bearer
 * <token>`, or the value of a custom header field, in constant time.
 *
 * @internal
 */
const tokenCheckOf = (options, label) => {
  if (typeof options.token !== 'string' || options.token === '') {
    throw new TypeError(
      `token is required: ${label} signs nothing, so its webhook carries a token.`,
    );
  }
  const header = options.header ?? 'authorization';
  if (typeof header !== 'string' || header === '') throw new TypeError('header is a field name.');
  const expected = Buffer.from(
    header.toLowerCase() === 'authorization' ? `Bearer ${options.token}` : options.token,
    'utf8',
  );
  return (request) => {
    const given = headerOf(request, header);
    if (given === undefined || !equalBytes(Buffer.from(given.trim(), 'utf8'), expected)) {
      throw new WebhookVerificationError('credentials', 'The webhook token does not match.');
    }
  };
};

const NUMBERED_TAG = /^tag(\d+)$/;

/**
 * The tags and metadata of a record of named tags, as the transports send
 * them where a provider has named tags only: `tag1`, `tag2`… hold the tags of
 * the message, in order, and the other names its metadata.
 *
 * @internal
 */
const splitNamedTags = (named) => {
  const numbered = [];
  const metadata = Object.create(null);
  if (!isRecord(named)) return { tags: [], metadata };
  for (const name in named) {
    const value = named[name];
    if (typeof value !== 'string') continue;
    const match = NUMBERED_TAG.exec(name);
    if (match === null) metadata[name] = value;
    else numbered.push({ index: Number(match[1]), value });
  }
  const tags = [];
  for (const entry of numbered.toSorted((a, b) => a.index - b.index)) tags.push(entry.value);
  return { tags, metadata };
};

module.exports = {
  WebhookVerificationError,
  basicCredentialsOf,
  bodyBytesOf,
  checkBasicCredentials,
  checkBodyHmac,
  checkReplay,
  checkTime,
  createEvent,
  createMemoryReplayStore,
  dateOf,
  equalBytes,
  headerOf,
  isRecord,
  jsonRecordOf,
  metadataFromHeaders,
  parseJsonOf,
  resolveCommonOptions,
  splitNamedTags,
  stringOf,
  stringRecordOf,
  stringsOf,
  tokenCheckOf,
};
