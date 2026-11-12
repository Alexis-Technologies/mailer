// Not ported: a message of Discord as the body of a message of a bot
// (https://discord.com/developers/docs/resources/message#create-message) or
// of a webhook (…/resources/webhook#execute-webhook): no mention notifies
// unless the message names it, through `allowed_mentions` rather than the
// text; its buttons as components, its pictures at a URL as embeds, its bytes
// as files of a multipart form; and the limits of Discord checked before the
// request.

const { createHash } = require('node:crypto');
const { readAttachmentContent } = require('../core/attachment.js');
const { generateId } = require('../core/id.js');
const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');

const MAX_CONTENT = 2000;
const MAX_EMBEDS = 10;
const MAX_FILES = 10;
const MAX_BUTTONS = 25;
const MAX_ROW = 5;
const MAX_LABEL = 80;
const MAX_CUSTOM_ID = 100;
const MAX_NONCE = 25;
// A message of no sound: the flag SUPPRESS_NOTIFICATIONS.
const SUPPRESS_NOTIFICATIONS = 1 << 12;
// A snowflake of Discord, the id of a channel or a thread: an integer of 64
// bits in decimal. It goes into the path, which `..` would leave.
const SNOWFLAKE = /^\d{1,20}$/;
const OWN_FIELDS = new Set(['nonce', 'enforce_nonce']);

const invalid = (message) => new InvalidMessageError(`Discord: ${message}`);
const unsupported = (message) => new RefusalError(`Discord: ${message}`);

/**
 * The nonce of a message: a hash of its key, or of an id of its own, of the
 * 25 characters Discord takes, so that the same message sent again is the
 * one Discord created.
 *
 * @internal
 */
const nonceOf = (message, config) => {
  const key = message.idempotencyKey ?? generateId('idempotency-key', config.generateId);
  return createHash('sha256').update(key).digest('base64url').slice(0, MAX_NONCE);
};

// Who may be notified: none, unless the message names them (T8, V10).
const allowedMentionsOf = (mentions) => {
  const allowed = { parse: mentions?.everyone === true ? ['everyone'] : [] };
  if (mentions?.users !== undefined) allowed.users = [...mentions.users];
  if (mentions?.roles !== undefined) allowed.roles = [...mentions.roles];
  return allowed;
};

const buttonOf = (button, toWebhook) => {
  if (button.text.length > MAX_LABEL) {
    throw invalid(`the text of a button is more than ${MAX_LABEL} characters.`);
  }
  if (button.type === 'url') return { type: 2, style: 5, label: button.text, url: button.url };
  if (button.type === 'reply') {
    if (toWebhook) throw unsupported('a webhook sends no button that replies.');
    if (button.id.length > MAX_CUSTOM_ID) {
      throw invalid(`the id of a button is more than ${MAX_CUSTOM_ID} characters.`);
    }
    return { type: 2, style: 1, label: button.text, custom_id: button.id };
  }
  throw unsupported('a button cannot call a phone.');
};

// The buttons in action rows of five.
const componentsOf = (buttons, toWebhook) => {
  if (buttons.length > MAX_BUTTONS) {
    throw invalid(`a message holds ${MAX_BUTTONS} buttons at most.`);
  }
  const rows = [];
  for (let i = 0; i < buttons.length; i++) {
    if (i % MAX_ROW === 0) rows.push({ type: 1, components: [] });
    rows[rows.length - 1].components.push(buttonOf(buttons[i], toWebhook));
  }
  return rows;
};

// Pictures at a URL as embeds; bytes as files; anything else refused.
const mediaOf = async (media, signal) => {
  const embeds = [];
  const files = [];
  for (const medium of media) {
    if (medium.content !== undefined) {
      const bytes = await readAttachmentContent(medium.content, signal);
      files.push({
        blob: new Blob([bytes], { type: medium.contentType }),
        filename: medium.filename ?? `file${files.length}`,
        description: medium.caption,
      });
    } else if (medium.url !== undefined && (medium.contentType ?? 'image/').startsWith('image/')) {
      embeds.push({ image: { url: medium.url } });
    } else {
      throw unsupported('a medium is its bytes, or a picture at its URL.');
    }
  }
  if (files.length > MAX_FILES) throw invalid(`a message holds ${MAX_FILES} files at most.`);
  return { embeds, files };
};

// The body of a request: JSON, or a form with its files and `payload_json`.
const bodyOf = (fields, files) => {
  if (files.length === 0) return fields;
  const attachments = [];
  for (let i = 0; i < files.length; i++) {
    const attachment = { id: i, filename: files[i].filename };
    if (files[i].description !== undefined) attachment.description = files[i].description;
    attachments.push(attachment);
  }
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ ...fields, attachments }));
  for (let i = 0; i < files.length; i++) {
    form.append(`files[${i}]`, files[i].blob, files[i].filename);
  }
  return form;
};

/**
 * The request of a message of Discord: through the REST API of a bot to the
 * channel of `to` (or of `thread`), or through the webhook without `to`.
 *
 * @param message The message, of `createChannelMessage`.
 * @param config The configuration.
 * @param signal Cancels the read of its media.
 * @returns `{ toWebhook, channelId, thread, body, hasButtons }`.
 * @throws {InvalidMessageError} If Discord would refuse it.
 * @throws {RefusalError} If it holds what Discord cannot send.
 * @internal
 */
const convertMessage = async (message, config, signal) => {
  if (message.channel !== 'discord') {
    throw unsupported(
      `the transport sends messages of discord, not of ${message.channel ?? 'email'}.`,
    );
  }
  const toWebhook = message.to === undefined;
  for (const id of [message.to, message.thread]) {
    if (id !== undefined && !SNOWFLAKE.test(id)) {
      throw invalid('a channel or a thread is named by its id, of decimal digits.');
    }
  }
  if (message.text !== undefined && message.text.length > MAX_CONTENT) {
    throw invalid(`the text is ${message.text.length} characters, more than ${MAX_CONTENT}.`);
  }
  const fields = {};
  if (message.text !== undefined) fields.content = message.text;
  fields.allowed_mentions = allowedMentionsOf(message.mentions);
  const media =
    message.media === undefined ? { embeds: [], files: [] } : await mediaOf(message.media, signal);
  if (media.embeds.length > 0) {
    if (message.payload?.embeds !== undefined) {
      throw invalid('give the pictures in the embeds of the payload, or neither.');
    }
    if (media.embeds.length > MAX_EMBEDS) {
      throw invalid(`a message holds ${MAX_EMBEDS} embeds at most.`);
    }
    fields.embeds = media.embeds;
  }
  if (message.buttons !== undefined) {
    if (message.payload?.components !== undefined) {
      throw invalid('give the buttons in the components of the payload, or neither.');
    }
    fields.components = componentsOf(message.buttons, toWebhook);
  }
  if (message.priority === 'low') fields.flags = SUPPRESS_NOTIFICATIONS;
  if (!toWebhook) {
    fields.nonce = nonceOf(message, config);
    fields.enforce_nonce = true;
  }
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      fields[name] = message.payload[name];
    }
  }
  const hasBody =
    fields.content !== undefined ||
    fields.embeds !== undefined ||
    fields.components !== undefined ||
    media.files.length > 0;
  if (!hasBody) throw invalid('a message needs a text, embeds, components or files.');
  return {
    toWebhook,
    channelId: message.thread ?? message.to,
    thread: message.thread,
    hasButtons: fields.components !== undefined,
    body: bodyOf(fields, media.files),
  };
};

module.exports = { convertMessage, nonceOf };
