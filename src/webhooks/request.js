// Not ported: what the webhook verifiers share — the raw body, the header
// fields of any kind of request, the error of a refusal, the window of time a
// signed request is taken in, the store of the ids already taken, the
// delivery of the events of a request, and the shape of an event.  sently
// parsed a payload apart from its check; here nothing is read before it is
// verified, and an id is kept as taken only once the application has handled
// its events.

const { createHmac, timingSafeEqual } = require('node:crypto');
const {
  checkOptionalFunction,
  checkPositiveInteger,
  checkPositiveNumber,
} = require('../internal/options.js');

const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
// Longer than an application takes to handle a request, shorter than the
// first retry of a provider (20 s for SNS), so that a request whose handler
// died is taken again.
const DEFAULT_LEASE_MS = 30 * 1000;
/**
 * How far from now a signed request is taken unless a verifier says
 * otherwise.
 *
 * @internal
 */
const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;
/**
 * How long the id of an event is kept when its provider signs no time and
 * retries for a day.
 *
 * @internal
 */
const DAY_REPLAY_TTL_MS = 25 * 60 * 60 * 1000;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const HEX = /^[0-9a-f]+$/i;
const REPLAY_METHODS = ['reserve', 'commit', 'release'];

// The answer a refusal asks for: a replay arrived before, so the provider
// may stop; a request still being handled may pass later, so it should try
// again; a body that cannot be read is the sender's; the rest is refused.
const STATUSES = new Map([
  ['replay', 200],
  ['pending', 503],
  ['payload', 400],
]);

/**
 * A request a verifier refused: `reason` says why, and `status` what to
 * answer the provider with.
 */
class WebhookVerificationError extends Error {
  /**
   * @param reason `signature`, `timestamp`, `replay`, `pending`, `payload`,
   * `certificate`, `topic` or `credentials`.
   * @param message What failed.
   * @param options The cause, and `status` when it is not that of the
   * reason (200 for `replay`, 503 for `pending`, 400 for `payload`, 401
   * otherwise).
   */
  constructor(reason, message, options) {
    super(message, options);
    this.name = 'WebhookVerificationError';
    this.reason = reason;
    this.status = options?.status ?? STATUSES.get(reason) ?? 401;
  }
}

/**
 * Makes a store of the ids of the requests taken, in this process: an id is
 * `pending` for the lease of the request that reserved it, and `done` for
 * its time once that request is committed.  It holds at most `maxEntries`
 * ids, the oldest done ones dropped first; a pending id is never dropped
 * before its lease ends.
 *
 * @param options `maxEntries` (10000) and `now`.
 * @returns `{ reserve(id, leaseMs), commit(id, ttlMs), release(id) }`.
 * @throws {TypeError} If an option is invalid.
 */
const createMemoryReplayStore = (options = {}) => {
  const maxEntries = checkPositiveInteger(options.maxEntries ?? 10000, 'maxEntries');
  const now = checkOptionalFunction(options.now, 'now') ?? Date.now;
  const entries = new Map();

  // A Map iterates in the order of insertion, and an entry is written anew
  // when it changes, so the first ones are the oldest.
  const trim = (at) => {
    for (const [id, entry] of entries) {
      const live = entry.expiresAt > at;
      if (live && entries.size <= maxEntries) break;
      if (live && !entry.done) continue;
      entries.delete(id);
    }
  };

  const write = (id, entry, at) => {
    entries.delete(id);
    entries.set(id, entry);
    trim(at);
  };

  return {
    reserve(id, leaseMs) {
      const at = now();
      const entry = entries.get(id);
      if (entry !== undefined && entry.expiresAt > at) return entry.done ? 'done' : 'pending';
      write(id, { done: false, expiresAt: at + leaseMs }, at);
      return 'reserved';
    },
    commit(id, ttlMs) {
      const at = now();
      write(id, { done: true, expiresAt: at + ttlMs }, at);
    },
    release(id) {
      if (entries.get(id)?.done === false) entries.delete(id);
    },
  };
};

const checkReplayStore = (store) => {
  if (store === undefined) {
    throw new TypeError(
      'replayStore is required: createMemoryReplayStore() for one process, a store the ' +
        'processes share for several, or null for an application that deduplicates the ' +
        'events by their id itself.',
    );
  }
  if (store === null) return null;
  for (const method of REPLAY_METHODS) {
    if (typeof store?.[method] !== 'function') {
      throw new TypeError(`replayStore must have a ${method} method, or be null.`);
    }
  }
  return store;
};

/**
 * Resolves the options every verifier takes.
 *
 * @internal
 */
const resolveCommonOptions = (options, defaultToleranceMs) => ({
  now: checkOptionalFunction(options.now, 'now') ?? Date.now,
  toleranceMs: checkPositiveNumber(options.toleranceMs ?? defaultToleranceMs, 'toleranceMs'),
  replayStore: checkReplayStore(options.replayStore),
  leaseMs: checkPositiveNumber(options.leaseMs ?? DEFAULT_LEASE_MS, 'leaseMs'),
  maxBodyBytes: checkPositiveNumber(options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES, 'maxBodyBytes'),
});

/**
 * Resolves the options of a verifier of a provider that signs neither a time
 * nor an id: its credentials stand for a request, and nothing is kept of it.
 *
 * @internal
 */
const resolveCredentialOptions = (options) =>
  resolveCommonOptions({ ...options, replayStore: null }, DEFAULT_TOLERANCE_MS);

/**
 * The events of a verified request, whose ids stay reserved in the replay
 * store until the application commits them, or releases them so that the
 * provider's next delivery is taken again.  A lease that runs out releases
 * them too.
 */
class WebhookDelivery {
  events = [];
  #store;
  #ttlMs;
  // The reserved ids, each with the number of its events not committed.
  #left = new Map();
  #keyOf = new WeakMap();

  constructor(fields, store, ttlMs) {
    for (const name in fields) {
      if (Object.hasOwn(fields, name)) this[name] = fields[name];
    }
    this.#store = store;
    this.#ttlMs = ttlMs;
  }

  add(key, events) {
    for (const event of events) this.events.push(event);
    if (this.#store === null) return;
    this.#left.set(key, events.length);
    for (const event of events) this.#keyOf.set(event, key);
  }

  get reserved() {
    return this.#left.size;
  }

  /**
   * Keeps the ids of the events handled as taken, so that the provider's
   * next delivery of them is a replay: of every event of the request, or of
   * those given.  An id that several events share is kept once all of them
   * are committed.
   *
   * @param events The events handled; all of them when left out.
   */
  async commit(events) {
    if (this.#store === null) return;
    if (events === undefined) {
      for (const key of this.#left.keys()) {
        await this.#store.commit(key, this.#ttlMs);
        this.#left.delete(key);
      }
      return;
    }
    for (const event of events) {
      const key = this.#keyOf.get(event);
      const left = key === undefined ? undefined : this.#left.get(key);
      if (left === undefined) continue;
      this.#keyOf.delete(event);
      if (left > 1) {
        this.#left.set(key, left - 1);
        continue;
      }
      await this.#store.commit(key, this.#ttlMs);
      this.#left.delete(key);
    }
  }

  /**
   * Frees the ids of the events not committed, so that the provider's next
   * delivery of them is taken: call it when handling the events failed.
   */
  async release() {
    if (this.#store === null) return;
    for (const key of this.#left.keys()) {
      await this.#store.release(key);
      this.#left.delete(key);
    }
  }
}

/**
 * Reserves the ids of the records of a verified request and makes the
 * delivery of the events of those that are new.  A record whose id was taken
 * before, or is being taken by another request, is left out; a request with
 * records and nothing new is refused, as `pending` while another request
 * holds one of them and as `replay` otherwise.  A failure releases what was
 * reserved.
 *
 * @param common The options of the verifier.
 * @param entries `{ key, events }` for each record, `key` its id in the
 * store.
 * @param fields The other fields of the result, such as `confirmation`.
 * @param ttlMs How long a committed id is kept: twice the window of time by
 * default, so that a request cannot come back in it.
 * @returns The delivery.
 * @internal
 */
const claimDelivery = async (common, entries, fields = {}, ttlMs = common.toleranceMs * 2) => {
  const store = common.replayStore;
  const delivery = new WebhookDelivery(fields, store, ttlMs);
  let done = 0;
  let pending = 0;
  try {
    for (const entry of entries) {
      const state = store === null ? 'reserved' : await store.reserve(entry.key, common.leaseMs);
      if (state === 'reserved') delivery.add(entry.key, entry.events);
      else if (state === 'pending') pending++;
      else if (state === 'done') done++;
      else throw new TypeError(`replayStore.reserve answered ${String(state)}.`);
    }
  } catch (error) {
    await delivery.release();
    throw error;
  }
  if (store === null || delivery.reserved > 0 || done + pending === 0) return delivery;
  const single = entries.length === 1;
  if (pending > 0) {
    throw new WebhookVerificationError(
      'pending',
      single
        ? `The request ${entries[0].key} is being handled by another delivery.`
        : 'The events of the batch are being handled by another delivery.',
    );
  }
  throw new WebhookVerificationError(
    'replay',
    single
      ? `The request ${entries[0].key} was taken before.`
      : 'Every event of the batch was taken before.',
  );
};

/**
 * The delivery of the events of a request whose provider gives no id to
 * take it by: nothing is kept, and committing it does nothing.
 *
 * @internal
 */
const deliveryOf = (events, fields) => {
  const delivery = new WebhookDelivery(fields, null, 0);
  delivery.add(undefined, events);
  return delivery;
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
 * Refuses a time a provider signs in whole seconds that is not one, or that
 * is too far from now.
 *
 * @internal
 */
const checkSignedSeconds = (value, common, label) => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new WebhookVerificationError('timestamp', `The ${label} timestamp is not a number.`);
  }
  checkTime(Number(value) * 1000, common);
};

/**
 * Compares two secrets in constant time.
 *
 * @internal
 */
const equalBytes = (a, b) => a.length === b.length && timingSafeEqual(a, b);

/**
 * The HMAC-SHA256 of the parts given, in order.
 *
 * @internal
 */
const hmacOf = (secret, parts) => {
  const hmac = createHmac('sha256', secret);
  for (const part of parts) hmac.update(part);
  return hmac.digest();
};

/**
 * Checks a signature given in hexadecimal against the digest expected.
 *
 * @internal
 */
const checkHexSignature = (expected, given, label) => {
  const hex = given?.trim();
  if (hex === undefined || !HEX.test(hex)) {
    throw new WebhookVerificationError('signature', `The request has no ${label} signature.`);
  }
  if (!equalBytes(expected, Buffer.from(hex, 'hex'))) {
    throw new WebhookVerificationError('signature', `The ${label} signature does not match.`);
  }
};

/**
 * A secret an option must hold: a string that is not empty.
 *
 * @internal
 */
const requireSecret = (value, message) => {
  if (typeof value !== 'string' || value === '') throw new TypeError(message);
  return value;
};

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

/**
 * Checks the HMAC-SHA256 of the raw body, in hexadecimal in a header field.
 *
 * @internal
 */
const checkBodyHmac = (request, bytes, header, secret, label) =>
  checkHexSignature(hmacOf(secret, [bytes]), headerOf(request, header), label);

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
 * The strings of a value that is one string or a list of them.
 *
 * @internal
 */
const stringListOf = (value) =>
  typeof value === 'string' && value !== '' ? [value] : stringsOf(value);

const SES_BOUNCE_KINDS = new Map([
  ['Permanent', 'hard'],
  ['Transient', 'soft'],
]);

/**
 * How a bounce of one of the types of SES went, which Resend passes on too.
 *
 * @internal
 */
const bounceKindOf = (type) => SES_BOUNCE_KINDS.get(type) ?? 'undetermined';

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
  DAY_REPLAY_TTL_MS,
  DEFAULT_TOLERANCE_MS,
  WebhookDelivery,
  WebhookVerificationError,
  basicCredentialsOf,
  bodyBytesOf,
  bounceKindOf,
  checkBasicCredentials,
  checkBodyHmac,
  checkHexSignature,
  checkSignedSeconds,
  checkTime,
  claimDelivery,
  createEvent,
  createMemoryReplayStore,
  dateOf,
  deliveryOf,
  equalBytes,
  headerOf,
  hmacOf,
  isRecord,
  jsonRecordOf,
  metadataFromHeaders,
  parseJsonOf,
  requireSecret,
  resolveCommonOptions,
  resolveCredentialOptions,
  splitNamedTags,
  stringListOf,
  stringOf,
  stringRecordOf,
  stringsOf,
  tokenCheckOf,
};
