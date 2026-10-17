// Not ported: what the webhook verifiers share — the raw body, the header
// fields of any kind of request, the error of a refusal, the window of time a
// signed request is taken in, the store of the ids already seen, and the
// shape of an event.  sently parsed a payload apart from its check; here
// nothing is read before it is verified.

const { timingSafeEqual } = require('node:crypto');
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
const checkReplay = async (common, id) => {
  if (common.replayStore === null) return;
  // Kept for twice the window, so a request cannot come back in it.
  if ((await common.replayStore.add(id, common.toleranceMs * 2)) !== true) {
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
  bodyBytesOf,
  checkReplay,
  checkTime,
  createEvent,
  createMemoryReplayStore,
  dateOf,
  equalBytes,
  headerOf,
  isRecord,
  parseJsonOf,
  resolveCommonOptions,
  splitNamedTags,
  stringOf,
};
