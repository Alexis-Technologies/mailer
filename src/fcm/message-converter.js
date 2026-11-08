// Not ported: a push as the body of messages:send of FCM HTTP v1
// (https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages):
// its token or topic, its title and text as the notification, its data, its
// picture, its priority and its expiry on each platform, and the payload as
// overrides over them; the reserved keys of its data refused before the
// request.

const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');

// The longest FCM keeps a message, four weeks.
const MAX_TTL_SECONDS = 28 * 24 * 60 * 60;
// The keys of data FCM refuses: its own words, and its prefixes.
const RESERVED_KEYS = new Set(['from', 'notification', 'message_type']);
const RESERVED_PREFIXES = ['google.', 'gcm.'];
const TARGETS = new Set(['token', 'topic', 'condition']);

const invalid = (message) => new InvalidMessageError(`FCM: ${message}`);
const unsupported = (message) => new RefusalError(`FCM: ${message}`);

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The payload over the message: its objects merged into ours, key by key,
// anything else in their place.
const merge = (base, over) => {
  const merged = { ...base };
  for (const key in over) {
    const value = over[key];
    merged[key] =
      isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
  }
  return merged;
};

const checkData = (data) => {
  for (const key in data) {
    if (RESERVED_KEYS.has(key)) throw invalid(`the key ${key} of data is FCM's own.`);
    for (const prefix of RESERVED_PREFIXES) {
      if (key.startsWith(prefix)) throw invalid(`a key of data starts with ${prefix}, FCM's own.`);
    }
  }
};

// The priority and the expiry, as each platform takes them (V16: not on
// Android alone).
const platformsOf = (message, now, silent) => {
  const android = {};
  const apns = { headers: {} };
  const webpush = { headers: {} };
  if (message.priority === 'high') {
    android.priority = 'HIGH';
    // A push of data alone takes no priority 10 on iOS, FCM says: 5.
    apns.headers['apns-priority'] = silent ? '5' : '10';
    webpush.headers.Urgency = 'high';
  } else if (message.priority === 'low') {
    android.priority = 'NORMAL';
    apns.headers['apns-priority'] = '5';
    webpush.headers.Urgency = 'low';
  }
  if (message.expiresAt !== undefined) {
    const at = message.expiresAt.getTime();
    const seconds = Math.min(MAX_TTL_SECONDS, Math.max(0, Math.ceil((at - now()) / 1000)));
    android.ttl = `${seconds}s`;
    apns.headers['apns-expiration'] = String(Math.max(0, Math.floor(at / 1000)));
    webpush.headers.TTL = String(seconds);
  }
  const platforms = {};
  if (Object.keys(android).length > 0) platforms.android = android;
  if (Object.keys(apns.headers).length > 0) platforms.apns = apns;
  if (Object.keys(webpush.headers).length > 0) platforms.webpush = webpush;
  return platforms;
};

/**
 * The body of messages:send of a push.
 *
 * @param message The message, of `createChannelMessage`.
 * @param config The configuration: `now`.
 * @returns `{ message }`.
 * @throws {InvalidMessageError} If FCM would refuse it.
 * @throws {RefusalError} If it holds what FCM cannot send.
 * @internal
 */
const convertMessage = (message, config) => {
  if (message.channel !== 'push') {
    throw unsupported(`the transport sends pushes, not messages of ${message.channel ?? 'email'}.`);
  }
  const to = message.to ?? {};
  if (to.token === undefined && to.topic === undefined) {
    throw unsupported(
      'a push of FCM goes to a token or a topic, not to a subscription of Web Push.',
    );
  }
  if (message.buttons !== undefined) throw unsupported('a push carries no buttons.');
  const fcm = to.token === undefined ? { topic: to.topic } : { token: to.token };
  const notification = {};
  if (message.title !== undefined) notification.title = message.title;
  if (message.text !== undefined) notification.body = message.text;
  if (message.media !== undefined && message.media.length > 0) {
    const [picture] = message.media;
    if (message.media.length > 1 || picture.url === undefined) {
      throw unsupported('a push carries one picture, at its URL.');
    }
    notification.image = picture.url;
  }
  if (Object.keys(notification).length > 0) fcm.notification = notification;
  if (message.data !== undefined) {
    checkData(message.data);
    fcm.data = { ...message.data };
  }
  const platforms = platformsOf(message, config.now ?? Date.now, fcm.notification === undefined);
  for (const key in platforms) fcm[key] = platforms[key];
  let sent = fcm;
  if (message.payload !== undefined) {
    for (const key in message.payload) {
      if (TARGETS.has(key)) throw invalid(`the payload cannot set ${key}.`);
    }
    sent = merge(fcm, message.payload);
  }
  if (fcm.notification === undefined && fcm.data === undefined && message.payload === undefined) {
    throw invalid('a push needs a title, a text, data or a payload.');
  }
  return { message: sent };
};

module.exports = { convertMessage };
