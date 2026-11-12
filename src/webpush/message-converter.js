// Not ported: a push as a request of Web Push (RFC 8030, RFC 8291): its
// notification as JSON, encrypted for the subscription, with its time to
// live, its urgency and its topic; the endpoint checked before the request,
// as a subscription comes from a browser and may name any host, and the size
// of the push, which push services refuse past 4096 bytes (V14).

const { Buffer } = require('node:buffer');
const { lookup: dnsLookup } = require('node:dns').promises;
const { InvalidMessageError } = require('../internal/channel/failure.js');
const { resolvesPublic } = require('../internal/public-url.js');
const { RefusalError } = require('../internal/refusal.js');
const { timerMs } = require('../internal/sleep.js');
const { untilAborted } = require('../internal/until-aborted.js');
const { MAX_PLAINTEXT, encryptPush } = require('./encryption.js');

// A Topic of RFC 8030 §5.4: 32 characters of base64url at most.
const TOPIC = /^[A-Za-z0-9_-]{1,32}$/;
const URGENCY = new Map([
  ['high', 'high'],
  ['normal', 'normal'],
  ['low', 'low'],
]);

const invalid = (message) => new InvalidMessageError(`Web Push: ${message}`);
const unsupported = (message) => new RefusalError(`Web Push: ${message}`);
// A subscription the transport does not send to, its endpoint or its keys:
// drop it.
const badSubscription = (message) =>
  Object.assign(new Error(`Web Push: ${message}`), { category: 'invalid-recipient' });

// The actions of a notification, as a service worker passes them on.
const actionsOf = (buttons) => {
  const actions = [];
  for (const button of buttons) {
    if (button.type === 'call') throw unsupported('a button cannot call a phone.');
    actions.push(
      button.type === 'url'
        ? { action: button.url, title: button.text, url: button.url }
        : { action: button.id, title: button.text },
    );
  }
  return actions;
};

// The notification the service worker reads of the push.
const notificationOf = (message) => {
  const notification = {};
  if (message.title !== undefined) notification.title = message.title;
  if (message.text !== undefined) notification.body = message.text;
  if (message.media !== undefined && message.media.length > 0) {
    if (message.media.length > 1 || message.media[0].url === undefined) {
      throw unsupported('a push carries one picture, at its URL.');
    }
    notification.image = message.media[0].url;
  }
  if (message.data !== undefined) notification.data = { ...message.data };
  if (message.buttons !== undefined) notification.actions = actionsOf(message.buttons);
  for (const key in message.payload) {
    if (key !== 'topic') notification[key] = message.payload[key];
  }
  return notification;
};

const isAllowed = async (endpoint, config) => {
  if (config.allowEndpoint !== undefined) return (await config.allowEndpoint(endpoint)) === true;
  return endpoint.protocol === 'https:' && resolvesPublic(endpoint, config.lookup ?? dnsLookup);
};

// The check of an endpoint, which may look its name up, ends with the
// caller's signal and the timeout of the transport, as a request does: a
// resolver that hangs does not hold a send.
const checkSignalOf = (signal, timeoutMs) => {
  const signals = [];
  if (signal !== undefined) signals.push(signal);
  if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
    signals.push(AbortSignal.timeout(timerMs(timeoutMs)));
  }
  return signals.length > 0 ? AbortSignal.any(signals) : undefined;
};

/**
 * The request of a push: its endpoint, its encrypted body and its headers.
 *
 * @param message The push, to a subscription.
 * @param config The configuration: `ttl`, `now`, `allowEndpoint`, `lookup`.
 * @returns `{ endpoint, body, headers }`.
 * @throws {InvalidMessageError} If a push service would refuse it.
 * @throws {RefusalError} If it holds what a push cannot carry.
 * @internal
 */
const convertMessage = async (message, config, signal) => {
  if (message.channel !== 'push') {
    throw unsupported(`the transport sends pushes, not messages of ${message.channel ?? 'email'}.`);
  }
  const to = message.to ?? {};
  if (to.endpoint === undefined) {
    throw unsupported(
      'a push of Web Push goes to a subscription, not to a token or a topic of FCM.',
    );
  }
  const endpoint = new URL(to.endpoint);
  const allowed = untilAborted(isAllowed(endpoint, config), checkSignalOf(signal, config.timeout));
  if (!(await allowed)) {
    throw badSubscription('the endpoint of the subscription is not a public HTTPS URL.');
  }
  const subscription = {
    p256dh: Buffer.from(to.keys.p256dh, 'base64url'),
    auth: Buffer.from(to.keys.auth, 'base64url'),
  };
  if (subscription.p256dh.length !== 65 || subscription.p256dh[0] !== 4) {
    throw badSubscription('the p256dh of the subscription is no public key of P-256.');
  }
  if (subscription.auth.length !== 16) {
    throw badSubscription('the auth of the subscription is not 16 bytes.');
  }
  const plaintext = Buffer.from(JSON.stringify(notificationOf(message)));
  if (plaintext.length > MAX_PLAINTEXT) {
    throw invalid(`the push is ${plaintext.length} bytes, more than ${MAX_PLAINTEXT}.`);
  }
  const topic = message.payload?.topic;
  if (topic !== undefined && (typeof topic !== 'string' || !TOPIC.test(topic))) {
    throw invalid('a topic is 1 to 32 characters of base64url.');
  }
  const ttl =
    message.expiresAt === undefined
      ? config.ttl
      : Math.max(0, Math.ceil((message.expiresAt.getTime() - config.now()) / 1000));
  const headers = {
    'Content-Encoding': 'aes128gcm',
    TTL: String(ttl),
    Urgency: URGENCY.get(message.priority) ?? 'normal',
  };
  if (topic !== undefined) headers.Topic = topic;
  let body;
  try {
    body = encryptPush(plaintext, subscription);
  } catch {
    // A p256dh of 65 bytes that is no point of the curve: a subscription to
    // drop, as one of the wrong length.
    throw badSubscription('the p256dh of the subscription is no public key of P-256.');
  }
  return { endpoint: endpoint.toString(), body, headers };
};

module.exports = { convertMessage };
