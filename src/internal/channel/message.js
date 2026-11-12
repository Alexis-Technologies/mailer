// Not ported: the message of a channel, built and checked once, so that a
// transport can rely on its fields as one of email relies on createMessage:
// a recipient of the channel's own kind (E.164 for a phone), media, buttons
// and a payload of JSON, the fields of one channel refused on another, and
// the metadata, schedule and tenant of internal/message-checks.js. A copy of a
// message (`{ ...message, text }`), such as a hook gives, is checked again by
// checkChannelMessage.

const { toJson } = require('../json.js');
const { checkKey, checkMetadata, checkScheduledAt, hasControl } = require('../message-checks.js');
const { CHANNELS } = require('./channels.js');
const { isE164, normalizePhone } = require('./phone.js');

const throwTypeError = (message) => {
  throw new TypeError(message);
};

const PHONE = new Set(['sms', 'rcs', 'whatsapp']);
const SCOPED = new Set(['messenger', 'instagram', 'viber']);
const WEBHOOK = new Set(['slack', 'discord', 'google-chat']);
const PRIORITIES = new Set(['high', 'normal', 'low']);
// The fields every channel takes, and those of some.
const COMMON = new Set([
  'channel',
  'to',
  'from',
  'text',
  'media',
  'buttons',
  'payload',
  'mentions',
  'tags',
  'priority',
  'metadata',
  'tenantId',
  'idempotencyKey',
  'scheduledAt',
  'expiresAt',
]);
const OWN_FIELDS = new Map([
  ['whatsapp', new Set(['template'])],
  ['telegram', new Set(['thread'])],
  ['slack', new Set(['thread'])],
  ['discord', new Set(['thread'])],
  ['google-chat', new Set(['thread'])],
  ['push', new Set(['title', 'data'])],
]);

const MAX_ID_LENGTH = 256;
const MAX_TOKEN_LENGTH = 4096;
const TELEGRAM_CHAT = /^(?:-?\d{1,20}|@[A-Za-z0-9_]{4,32})$/;
const FCM_TOPIC = /^[A-Za-z0-9\-_.~%]{1,900}$/;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const LANGUAGE = /^[A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})*$/;
const MEDIA_TYPE = /^[\w.+-]+\/[\w.+-]+$/;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// An id of a recipient, a sender or a button: printable, no space.
const isId = (value, max = MAX_ID_LENGTH) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
};

const isUrl = (value, protocols) => {
  if (typeof value !== 'string' || !URL.canParse(value)) return false;
  return protocols.has(new URL(value).protocol);
};
const HTTP = new Set(['http:', 'https:']);
const HTTPS = new Set(['https:']);

const checkFields = (value, allowed, what) => {
  for (const key in value) {
    if (Object.hasOwn(value, key) && value[key] !== undefined && !allowed.has(key)) {
      throwTypeError(`${what} takes no ${key}.`);
    }
  }
};

const checkText = (value, name) => {
  if (value !== undefined && typeof value !== 'string') throwTypeError(`${name} must be a string.`);
  return value;
};

const checkLine = (value, name) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || hasControl(value)) {
    throwTypeError(`${name} must be a string without control characters.`);
  }
  return value;
};

const checkDate = (value, name) => {
  if (value === undefined) return undefined;
  const time = value instanceof Date ? value.getTime() : Number.NaN;
  if (Number.isNaN(time)) throwTypeError(`${name} must be a valid Date.`);
  return new Date(time);
};

// The recipient of a message, of its channel's kind; a phone in any form
// people write one when `defaultCountry` is given, and only in E.164 when
// `strict`.
const recipientOf = (channel, to, options, strict) => {
  if (PHONE.has(channel)) {
    if (isE164(to)) return to;
    const number = strict ? undefined : normalizePhone(to, options);
    return number ?? throwTypeError(`The recipient of ${channel} is no phone number in E.164.`);
  }
  if (SCOPED.has(channel)) {
    return isId(to) ? to : throwTypeError(`The recipient of ${channel} must be its id.`);
  }
  if (channel === 'telegram') {
    if (Number.isSafeInteger(to) || (typeof to === 'string' && TELEGRAM_CHAT.test(to))) return to;
    return throwTypeError('The recipient of telegram is a chat id or the @username of a channel.');
  }
  if (WEBHOOK.has(channel)) {
    if (to === undefined || isId(to)) return to;
    return throwTypeError(`The recipient of ${channel} must be the id of a channel or a space.`);
  }
  if (channel === 'teams') return teamsRecipientOf(to);
  return pushRecipientOf(to);
};

// A URL with no user or password, which fetch would refuse, its error
// printing the URL: the service URL of Teams, which a token goes to.
const hasNoUserinfo = (value) => {
  const url = new URL(value);
  return url.username === '' && url.password === '';
};

// The id of a conversation of Teams goes into the path of its activities,
// which `encodeURIComponent` leaves `.` and `..` in, as segments that would
// move the request, and the token of the bot, to another path.
const DOT_SEGMENTS = new Set(['.', '..']);

const teamsRecipientOf = (to) => {
  if (to === undefined) return undefined;
  if (
    !isObject(to) ||
    !isUrl(to.serviceUrl, HTTPS) ||
    !hasNoUserinfo(to.serviceUrl) ||
    !isId(to.conversationId) ||
    DOT_SEGMENTS.has(to.conversationId)
  ) {
    throwTypeError(
      'The recipient of teams is { serviceUrl, conversationId }, an https serviceUrl with no user.',
    );
  }
  return { serviceUrl: to.serviceUrl, conversationId: to.conversationId };
};

const pushRecipientOf = (to) => {
  if (isObject(to) && to.token !== undefined) {
    if (!isId(to.token, MAX_TOKEN_LENGTH)) throwTypeError('The token of a push is no token.');
    return { token: to.token };
  }
  if (isObject(to) && to.topic !== undefined) {
    if (typeof to.topic !== 'string' || !FCM_TOPIC.test(to.topic)) {
      throwTypeError('The topic of a push is 1 to 900 of A-Z, a-z, 0-9 and -_.~%.');
    }
    return { topic: to.topic };
  }
  const keys = isObject(to) ? to.keys : undefined;
  if (
    !isUrl(to?.endpoint, HTTPS) ||
    !isObject(keys) ||
    typeof keys.p256dh !== 'string' ||
    !BASE64URL.test(keys.p256dh) ||
    typeof keys.auth !== 'string' ||
    !BASE64URL.test(keys.auth)
  ) {
    throwTypeError(
      'The recipient of a push is { token }, { topic } or a Web Push subscription ' +
        '{ endpoint, keys: { p256dh, auth } } with an https endpoint.',
    );
  }
  return { endpoint: to.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
};

const MEDIA_FIELDS = new Set(['url', 'id', 'content', 'contentType', 'filename', 'caption']);

const isContent = (content) =>
  content instanceof Uint8Array ||
  content instanceof Blob ||
  typeof content === 'function' ||
  content instanceof Promise;

const mediumOf = (medium) => {
  if (!isObject(medium)) throwTypeError('A medium is { url }, { id } or { content, contentType }.');
  checkFields(medium, MEDIA_FIELDS, 'A medium');
  const sources =
    (medium.url === undefined ? 0 : 1) +
    (medium.id === undefined ? 0 : 1) +
    (medium.content === undefined ? 0 : 1);
  if (sources !== 1) throwTypeError('A medium has one of url, id and content.');
  if (medium.url !== undefined && !isUrl(medium.url, HTTP)) {
    throwTypeError('The url of a medium must be an http or https URL.');
  }
  if (medium.id !== undefined && !isId(medium.id)) throwTypeError('The id of a medium is no id.');
  if (medium.content !== undefined && (!isContent(medium.content) || medium.contentType == null)) {
    throwTypeError('The content of a medium is bytes, a Blob or a factory, with its contentType.');
  }
  if (
    medium.contentType !== undefined &&
    (typeof medium.contentType !== 'string' || !MEDIA_TYPE.test(medium.contentType))
  ) {
    throwTypeError(`Invalid contentType of a medium: ${JSON.stringify(medium.contentType)}.`);
  }
  const copy = {};
  for (const name of MEDIA_FIELDS) {
    if (medium[name] !== undefined) copy[name] = medium[name];
  }
  checkLine(copy.filename, 'The filename of a medium');
  checkText(copy.caption, 'The caption of a medium');
  return copy;
};

const BUTTON_FIELDS = new Map([
  ['url', new Set(['type', 'text', 'url'])],
  ['reply', new Set(['type', 'text', 'id'])],
  ['call', new Set(['type', 'text', 'phone'])],
]);

const buttonOf = (button) => {
  const fields = isObject(button) ? BUTTON_FIELDS.get(button.type) : undefined;
  if (fields === undefined) throwTypeError("A button's type is url, reply or call.");
  checkFields(button, fields, `A button of type ${button.type}`);
  if (typeof button.text !== 'string' || button.text === '') {
    throwTypeError('A button needs its text.');
  }
  if (button.type === 'url' && !isUrl(button.url, HTTP)) {
    throwTypeError('The url of a button must be an http or https URL.');
  }
  if (button.type === 'reply' && !isId(button.id)) throwTypeError('A reply button needs its id.');
  if (button.type === 'call' && !isE164(button.phone)) {
    throwTypeError('A call button needs a phone in E.164.');
  }
  const copy = { type: button.type, text: button.text };
  if (button.type === 'url') copy.url = button.url;
  else if (button.type === 'reply') copy.id = button.id;
  else copy.phone = button.phone;
  return copy;
};

const listOf = (value, name, item) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throwTypeError(`${name} must be an array.`);
  const list = [];
  for (const entry of value) list.push(item(entry));
  return list;
};

const idsOf = (value, name) =>
  listOf(value, name, (id) => (isId(id) ? id : throwTypeError(`${name} must hold ids.`)));

const MENTION_FIELDS = new Set(['everyone', 'users', 'roles']);

const mentionsOf = (mentions) => {
  if (mentions === undefined) return undefined;
  if (!isObject(mentions)) throwTypeError('mentions is { everyone, users, roles }.');
  checkFields(mentions, MENTION_FIELDS, 'mentions');
  const copy = {};
  if (mentions.everyone !== undefined) {
    if (typeof mentions.everyone !== 'boolean') throwTypeError('mentions.everyone is a boolean.');
    copy.everyone = mentions.everyone;
  }
  const users = idsOf(mentions.users, 'mentions.users');
  if (users !== undefined) copy.users = users;
  const roles = idsOf(mentions.roles, 'mentions.roles');
  if (roles !== undefined) copy.roles = roles;
  return copy;
};

const TEMPLATE_FIELDS = new Set(['name', 'language', 'components']);

const templateOf = (template) => {
  if (template === undefined) return undefined;
  if (!isObject(template)) throwTypeError('template is { name, language, components }.');
  checkFields(template, TEMPLATE_FIELDS, 'template');
  if (!isId(template.name)) throwTypeError('template needs its name.');
  if (typeof template.language !== 'string' || !LANGUAGE.test(template.language)) {
    throwTypeError(`Invalid language of a template: ${JSON.stringify(template.language)}.`);
  }
  const copy = { name: template.name, language: template.language };
  if (template.components !== undefined) {
    copy.components = listOf(template.components, 'template.components', (component) =>
      isObject(component)
        ? toJson(component, 'a component of template')
        : throwTypeError('A component of a template is an object.'),
    );
  }
  return copy;
};

const dataOf = (data) => {
  if (data === undefined) return undefined;
  if (!isObject(data)) throwTypeError('data must be an object of strings.');
  const copy = Object.create(null);
  for (const key in data) {
    if (!Object.hasOwn(data, key)) continue;
    if (key === '' || typeof data[key] !== 'string') {
      throwTypeError(`Invalid data of ${JSON.stringify(key)}: a string.`);
    }
    copy[key] = data[key];
  }
  return Object.freeze(copy);
};

const tagsOf = (tags, strict) => {
  if (tags === undefined && !strict) return [];
  const list = !strict && typeof tags === 'string' ? [tags] : tags;
  return listOf(list ?? null, 'tags', (tag) =>
    typeof tag === 'string' && tag !== '' ? tag : throwTypeError('A tag is a non-empty string.'),
  );
};

const priorityOf = (priority, strict) => {
  const value = priority === undefined && !strict ? 'normal' : priority;
  return PRIORITIES.has(value) ? value : throwTypeError('priority is high, normal or low.');
};

// Copies the defined fields of a message, in a fixed order.
const assign = (message, name, value) => {
  if (value !== undefined) message[name] = value;
};

const hasKey = (object) => {
  for (const key in object) {
    if (Object.hasOwn(object, key)) return true;
  }
  return false;
};

// What the message says, so that one with nothing to send is refused: an
// empty text, list of media, payload or data says nothing.
const hasBody = (message) =>
  (message.text !== undefined && message.text !== '') ||
  (message.media !== undefined && message.media.length > 0) ||
  (message.payload !== undefined && hasKey(message.payload)) ||
  message.template !== undefined ||
  (message.title !== undefined && message.title !== '') ||
  (message.data !== undefined && hasKey(message.data));

/**
 * Builds a message of a channel, or checks one already built (`strict`): its
 * `to` then in E.164 already, its `tags` and `priority` given.
 *
 * @internal
 */
const buildChannelMessage = (input, options, strict) => {
  if (!isObject(input)) throwTypeError('A message of a channel is an object.');
  const { channel } = input;
  if (channel === 'email') throwTypeError('An email message is made by createMessage.');
  if (!CHANNELS.has(channel)) throwTypeError(`Unknown channel: ${JSON.stringify(channel)}.`);
  const own = OWN_FIELDS.get(channel);
  for (const key in input) {
    const known = COMMON.has(key) || own?.has(key) === true;
    if (Object.hasOwn(input, key) && input[key] !== undefined && !known) {
      throwTypeError(`A message of ${channel} takes no ${key}.`);
    }
  }
  const message = { channel };
  assign(message, 'to', recipientOf(channel, input.to, options, strict));
  assign(message, 'from', checkLine(input.from, 'from'));
  assign(message, 'text', checkText(input.text, 'text'));
  assign(message, 'media', listOf(input.media, 'media', mediumOf));
  assign(message, 'buttons', listOf(input.buttons, 'buttons', buttonOf));
  if (input.payload !== undefined) {
    if (!isObject(input.payload)) throwTypeError('payload must be an object of JSON.');
    message.payload = toJson(input.payload, 'payload');
  }
  assign(message, 'mentions', mentionsOf(input.mentions));
  assign(message, 'template', templateOf(input.template));
  if (input.thread !== undefined && !isId(input.thread)) throwTypeError('thread must be an id.');
  assign(message, 'thread', input.thread);
  assign(message, 'title', checkText(input.title, 'title'));
  assign(message, 'data', dataOf(input.data));
  if (!hasBody(message)) throwTypeError(`A message of ${channel} has nothing to send.`);
  message.tags = tagsOf(input.tags, strict);
  message.priority = priorityOf(input.priority, strict);
  assign(message, 'metadata', checkMetadata(input.metadata));
  assign(message, 'tenantId', checkKey(input.tenantId, 'tenantId'));
  assign(message, 'idempotencyKey', checkKey(input.idempotencyKey, 'idempotencyKey'));
  assign(message, 'scheduledAt', checkScheduledAt(input.scheduledAt));
  assign(message, 'expiresAt', checkDate(input.expiresAt, 'expiresAt'));
  if (message.expiresAt !== undefined && message.expiresAt <= (message.scheduledAt ?? 0)) {
    throwTypeError('expiresAt must come after scheduledAt.');
  }
  return message;
};

/**
 * Creates the message of a channel other than email.
 *
 * @param input Its fields: `channel` and `to`, and what it sends.
 * @param options `defaultCountry`, the country of a phone number written
 * without its calling code.
 * @returns The message.
 * @throws {TypeError} If a field is not one the channel takes.
 * @internal
 */
const createChannelMessage = (input, options = {}) => buildChannelMessage(input, options, false);

/**
 * Checks again a message of a channel already made, such as a copy a hook
 * gives in place of another.
 *
 * @throws {TypeError} If a field is one createChannelMessage refuses.
 * @internal
 */
const checkChannelMessage = (message) => {
  buildChannelMessage(message, undefined, true);
};

/**
 * Whether a value is a message of a channel other than email, by its
 * `channel`: what `./router` and the decorators branch on.
 *
 * @internal
 */
const isChannelMessage = (value) => isObject(value) && CHANNELS.has(value.channel);

module.exports = {
  checkChannelMessage,
  createChannelMessage,
  isChannelMessage,
  isContent,
  isObject,
};
