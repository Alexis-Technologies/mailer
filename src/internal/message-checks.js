// Ported from unemail v0.7.0 (src/core/message.ts): the checks of
// `scheduledAt` and `metadata`, which every message carries, whatever its
// channel; with the bounds of fixes U3 and R19, and the check of a key of
// the queue (a tenant, an idempotency key), so that a message and a job hold
// one rule each.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const throwTypeError = (message) => {
  throw new TypeError(message);
};

/**
 * Whether a text holds a control character (C0 or DEL).
 *
 * @internal
 */
const hasControl = (text) => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

/**
 * Checks when a message is to be sent and copies it, so that a later
 * mutation of the caller's `Date` cannot change what a retry sends.
 *
 * @param date The date, if any.
 * @returns A copy of the date, or `undefined` if none was given.
 * @throws {TypeError} If it is not a valid `Date`.
 * @internal
 */
const checkScheduledAt = (date) => {
  if (date == null) return undefined;
  const time = date instanceof Date ? date.getTime() : Number.NaN;
  if (Number.isNaN(time)) throwTypeError(`Invalid scheduledAt: ${JSON.stringify(date)}`);
  return new Date(time);
};

// A key may become the name of a header field (`X-Metadata-<key>`) or of a
// form field (`v:<key>`), so it holds no more than letters, digits, `_`, `-`
// and `.`; a value no control character.
const METADATA_KEY = /^[A-Za-z0-9_.-]{1,128}$/;
// Every provider bounds what it keeps (Postmark 10 fields of 80 characters,
// SendGrid 10,000 bytes); these bounds keep a value meant for an event from
// making a message of any size, and leave each provider's own to it.
const MAX_METADATA_KEYS = 64;
const MAX_METADATA_VALUE = 1024;

/**
 * Checks the metadata of a message and copies it into a frozen dictionary.
 *
 * @param metadata The metadata, if any.
 * @returns The copy, or `undefined` if none was given.
 * @throws {TypeError} If it is not an object of at most 64 keys of
 * `[A-Za-z0-9_.-]`, each a string of at most 1024 characters without
 * control characters.
 * @internal
 */
const checkMetadata = (metadata) => {
  if (metadata == null) return undefined;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throwTypeError('Invalid metadata: it must be an object of strings.');
  }
  const checked = Object.create(null);
  let count = 0;
  for (const key in metadata) {
    if (!Object.hasOwn(metadata, key)) continue;
    if (++count > MAX_METADATA_KEYS) {
      throwTypeError(`Invalid metadata: more than ${MAX_METADATA_KEYS} keys.`);
    }
    if (!METADATA_KEY.test(key)) throwTypeError(`Invalid metadata key: ${JSON.stringify(key)}`);
    const value = metadata[key];
    if (typeof value !== 'string' || hasControl(value)) {
      throwTypeError(`Invalid metadata value of ${key}: a string without control characters.`);
    }
    if (value.length > MAX_METADATA_VALUE) {
      throwTypeError(`Invalid metadata value of ${key}: over ${MAX_METADATA_VALUE} characters.`);
    }
    checked[key] = value;
  }
  return Object.freeze(checked);
};

const MAX_KEY_LENGTH = 256;

/**
 * Checks a key of a message or a job, such as its tenant or its idempotency
 * key: what a store keys a job by and a log writes as it is.
 *
 * @param value The key, if any.
 * @param name How the error names it.
 * @returns The key.
 * @throws {TypeError} If it is not a string of 1 to 256 characters without
 * control characters.
 * @internal
 */
const checkKey = (value, name) => {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_KEY_LENGTH ||
    hasControl(value)
  ) {
    throwTypeError(`${name} must be a string of 1 to ${MAX_KEY_LENGTH} characters.`);
  }
  return value;
};

module.exports = {
  MAX_KEY_LENGTH,
  checkKey,
  checkMetadata,
  checkScheduledAt,
  hasControl,
};
