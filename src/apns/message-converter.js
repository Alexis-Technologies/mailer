// Ported from @thinwrap/notifications v1.2.0 (src/providers/apns/apns.connector.ts):
// a push as the request of APNs: its title and text as `aps.alert`, its data
// at the root of the payload, and the type of the push told by what it holds
// (`finalizePushType`), a background one with priority 5 and
// `content-available`.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: the payload is the headers and payload of APNs, the
// shape of `apns` of FCM; the id of the push is the `apns-id` sent, derived
// from the idempotency key when there is one; and a payload over the 4 KB
// of APNs (5 KB for VoIP) is refused before the request.

const { Buffer } = require('node:buffer');
const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');
const { toUuid } = require('../internal/uuid.js');

const MAX_PAYLOAD = 4096;
const MAX_VOIP_PAYLOAD = 5120;
const DEVICE_TOKEN = /^[0-9A-Fa-f]{1,4096}$/;
const PAYLOAD_KEYS = new Set(['headers', 'payload']);
const INTERACTIVE = ['alert', 'badge', 'sound'];

const invalid = (message) => new InvalidMessageError(`APNs: ${message}`);
const unsupported = (message) => new RefusalError(`APNs: ${message}`);
const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A device token that is no token of APNs, refused as its recipient.
const badToken = () =>
  Object.assign(new Error('APNs: the token of the device is not of hexadecimal digits.'), {
    category: 'invalid-recipient',
  });

const merge = (base, over) => {
  const merged = { ...base };
  for (const key in over) {
    const value = over[key];
    merged[key] =
      isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
  }
  return merged;
};

// The header fields of the payload: those of APNs alone, as strings.
const headersOf = (fields) => {
  const headers = Object.create(null);
  if (fields === undefined) return headers;
  if (!isPlainObject(fields)) throw invalid('the headers of the payload are an object.');
  for (const name in fields) {
    const lower = name.toLowerCase();
    if (!lower.startsWith('apns-')) throw invalid(`the payload cannot set the header ${name}.`);
    if (typeof fields[name] !== 'string') throw invalid(`the header ${name} is a string.`);
    headers[lower] = fields[name];
  }
  return headers;
};

const isEmpty = (object) => {
  for (const key in object) {
    if (Object.hasOwn(object, key)) return false;
  }
  return true;
};

const isInteractive = (aps) => {
  for (const key of INTERACTIVE) {
    if (aps[key] !== undefined) return true;
  }
  return false;
};

/**
 * The request of a push: the token of its device, its header fields and
 * the JSON of its payload.
 *
 * @param message The message, of `createChannelMessage`.
 * @param config The configuration: `topic`, `generateId`.
 * @returns `{ token, id, headers, body }`.
 * @throws {InvalidMessageError} If APNs would refuse it.
 * @throws {RefusalError} If it holds what APNs cannot send.
 * @internal
 */
const convertMessage = (message, config) => {
  if (message.channel !== 'push') {
    throw unsupported(`the transport sends pushes, not messages of ${message.channel ?? 'email'}.`);
  }
  const token = message.to?.token;
  if (token === undefined) {
    throw unsupported(
      'a push of APNs goes to the token of a device, not a topic or a subscription.',
    );
  }
  if (!DEVICE_TOKEN.test(token)) throw badToken();
  if (message.media !== undefined && message.media.length > 0) {
    throw unsupported('a push carries no media; a notification service extension fetches them.');
  }
  if (message.buttons !== undefined) {
    throw unsupported('a push carries no buttons; they are the actions of an aps.category.');
  }
  const extra = message.payload ?? {};
  for (const key in extra) {
    if (!PAYLOAD_KEYS.has(key)) throw invalid(`the payload holds headers and payload, not ${key}.`);
  }
  const aps = {};
  if (message.title !== undefined || message.text !== undefined) {
    aps.alert = {};
    if (message.title !== undefined) aps.alert.title = message.title;
    if (message.text !== undefined) aps.alert.body = message.text;
  }
  let body = { aps };
  if (message.data !== undefined) {
    for (const key in message.data) {
      if (key === 'aps') throw invalid('the key aps of data is APNs own.');
      body[key] = message.data[key];
    }
  }
  if (extra.payload !== undefined) {
    if (!isPlainObject(extra.payload)) throw invalid('the payload of the payload is an object.');
    body = merge(body, extra.payload);
  }
  if (!isPlainObject(body.aps)) throw invalid('aps is an object.');
  const given = headersOf(extra.headers);
  const pushType = given['apns-push-type'] ?? (isInteractive(body.aps) ? 'alert' : 'background');
  if (pushType === 'background') {
    // Apple: a background push has priority 5 and content-available alone.
    let alone = true;
    for (const key in body) {
      if (key !== 'aps') alone = false;
    }
    if (alone && isEmpty(body.aps)) {
      throw invalid('a push needs a title, a text, data or a payload.');
    }
    body.aps = { 'content-available': 1, ...body.aps };
  }
  const headers = {
    'content-type': 'application/json',
    'apns-push-type': pushType,
    'apns-topic': config.topic,
    'apns-id':
      message.idempotencyKey === undefined ? config.generateId() : toUuid(message.idempotencyKey),
  };
  if (pushType === 'background' || message.priority === 'low') headers['apns-priority'] = '5';
  else if (message.priority === 'high') headers['apns-priority'] = '10';
  if (message.expiresAt !== undefined) {
    headers['apns-expiration'] = String(
      Math.max(0, Math.floor(message.expiresAt.getTime() / 1000)),
    );
  }
  for (const name in given) headers[name] = given[name];
  const json = JSON.stringify(body);
  const limit = pushType === 'voip' ? MAX_VOIP_PAYLOAD : MAX_PAYLOAD;
  if (Buffer.byteLength(json) > limit) {
    throw invalid(`the payload is more than the ${limit} bytes of a push of type ${pushType}.`);
  }
  return { token, id: headers['apns-id'], headers, body: json };
};

module.exports = { convertMessage };
