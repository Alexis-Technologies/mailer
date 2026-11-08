// Not ported: a message of Telegram as a call of the Bot API
// (https://core.telegram.org/bots/api): its text by sendMessage, one medium
// by the method of its kind, several by sendMediaGroup, its buttons as an
// inline keyboard, and its bytes as the files of a multipart form. Neither
// thinwrap nor node-telegram-bot-api checks the limits of the API before the
// request; they are checked here, so that a message the API would refuse
// fails as `validation` without a request.

const { readAttachmentContent } = require('../core/attachment.js');
const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');

const MAX_TEXT = 4096;
const MAX_CAPTION = 1024;
const MAX_CALLBACK_BYTES = 64;
const MAX_ALBUM = 10;
// The fields of a call the transport writes, which a payload may not.
const OWN_FIELDS = new Set(['chat_id']);
// The kinds of a medium and the method of each: a photo, an animation, a
// video, an audio, or a document for any other type.
const KINDS = [
  ['image/gif', 'animation', 'sendAnimation'],
  ['image/', 'photo', 'sendPhoto'],
  ['video/', 'video', 'sendVideo'],
  ['audio/', 'audio', 'sendAudio'],
];
// What sendMediaGroup takes together: photos and videos, or documents
// alone, or audios alone.
const ALBUM_GROUPS = new Map([
  ['photo', 'visual'],
  ['video', 'visual'],
  ['document', 'document'],
  ['audio', 'audio'],
]);

const invalid = (message) => new InvalidMessageError(`Telegram: ${message}`);
const unsupported = (message) => new RefusalError(`Telegram: ${message}`);
const TOPIC = /^\d{1,20}$/;

const kindOf = (medium) => {
  const type = medium.contentType ?? '';
  for (const [prefix, kind, method] of KINDS) {
    if (type === prefix || (prefix.endsWith('/') && type.startsWith(prefix))) {
      return { kind, method };
    }
  }
  return { kind: 'document', method: 'sendDocument' };
};

// The inline keyboard of the buttons, one a row: a link or a callback.
const keyboardOf = (buttons) => {
  const rows = [];
  for (const button of buttons) {
    if (button.type === 'url') {
      rows.push([{ text: button.text, url: button.url }]);
    } else if (button.type === 'reply') {
      if (Buffer.byteLength(button.id) > MAX_CALLBACK_BYTES) {
        throw invalid(`the id of a reply button is more than ${MAX_CALLBACK_BYTES} bytes.`);
      }
      rows.push([{ text: button.text, callback_data: button.id }]);
    } else {
      throw unsupported('an inline button cannot call a phone.');
    }
  }
  return { inline_keyboard: rows };
};

const checkLength = (text, max, what, config, payload) => {
  // With markup, Telegram counts the text after its entities are parsed,
  // which only it can do.
  const markup = payload?.parse_mode ?? config.parseMode;
  if (markup === undefined && text.length > max) {
    throw invalid(`${what} is ${text.length} characters, more than ${max}.`);
  }
};

// What a medium is sent as: a URL or a file_id as it is, bytes as a file of
// the form, named by its field.
const sourceOf = async (medium, field, files, signal) => {
  if (medium.url !== undefined) return medium.url;
  if (medium.id !== undefined) return medium.id;
  const bytes = await readAttachmentContent(medium.content, signal);
  files.push({
    field,
    blob: new Blob([bytes], { type: medium.contentType }),
    filename: medium.filename ?? field,
  });
  return `attach://${field}`;
};

// The caption of the first medium: its own, or the text of the message.
const captionOf = (message, medium, index) => {
  if (index > 0) return medium.caption;
  if (medium.caption !== undefined && message.text !== undefined) {
    throw invalid('the text is the caption of the first medium: give one or the other.');
  }
  return medium.caption ?? message.text;
};

const albumOf = async (message, config, files, signal) => {
  if (message.media.length > MAX_ALBUM) {
    throw invalid(`an album holds ${MAX_ALBUM} media at most, not ${message.media.length}.`);
  }
  if (message.buttons !== undefined) throw unsupported('an album takes no buttons.');
  const items = [];
  let group;
  for (let index = 0; index < message.media.length; index++) {
    const medium = message.media[index];
    const { kind } = kindOf(medium);
    const sent = kind === 'animation' ? 'document' : kind;
    const of = ALBUM_GROUPS.get(sent);
    if (group !== undefined && of !== group) {
      throw unsupported('an album takes photos and videos, or documents, or audios.');
    }
    group = of;
    const item = { type: sent, media: await sourceOf(medium, `file${index}`, files, signal) };
    const caption = captionOf(message, medium, index);
    if (caption !== undefined) {
      checkLength(caption, MAX_CAPTION, 'a caption', config, message.payload);
      item.caption = caption;
      if (config.parseMode !== undefined) item.parse_mode = config.parseMode;
    }
    items.push(item);
  }
  return { method: 'sendMediaGroup', fields: { media: items } };
};

const singleOf = async (message, config, files, signal) => {
  const medium = message.media[0];
  const { kind, method } = kindOf(medium);
  // Bytes go as the file of the field of their kind itself; attach:// is an
  // album's.
  const source = await sourceOf(medium, kind, files, signal);
  const fields = medium.content === undefined ? { [kind]: source } : {};
  const caption = captionOf(message, medium, 0);
  if (caption !== undefined) {
    checkLength(caption, MAX_CAPTION, 'a caption', config, message.payload);
    fields.caption = caption;
  }
  return { method, fields };
};

const textOf = (message, config) => {
  if (message.text === undefined || message.text === '') {
    if (message.payload?.text !== undefined) return { method: 'sendMessage', fields: {} };
    throw invalid('a message needs a text or media.');
  }
  checkLength(message.text, MAX_TEXT, 'the text', config, message.payload);
  return { method: 'sendMessage', fields: { text: message.text } };
};

// The body of a call: JSON, or a form with the files and the other fields,
// objects as JSON.
const bodyOf = (fields, files) => {
  if (files.length === 0) return fields;
  const form = new FormData();
  for (const name in fields) {
    const value = fields[name];
    form.append(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  for (const file of files) form.append(file.field, file.blob, file.filename);
  return form;
};

/**
 * The call of the Bot API that sends a message of Telegram.
 *
 * @param message The message, of `createChannelMessage`.
 * @param config The configuration: `parseMode`.
 * @param signal Cancels the read of its media.
 * @returns `{ method, body }`.
 * @throws {InvalidMessageError} If Telegram would refuse it.
 * @throws {RefusalError} If it holds what Telegram cannot send.
 * @internal
 */
const convertMessage = async (message, config, signal) => {
  if (message.channel !== 'telegram') {
    throw unsupported(
      `the transport sends messages of telegram, not of ${message.channel ?? 'email'}.`,
    );
  }
  if (message.to === undefined || message.to === '') throw invalid('a message needs its chat.');
  const files = [];
  let call;
  if (message.media === undefined || message.media.length === 0) call = textOf(message, config);
  else if (message.media.length === 1) call = await singleOf(message, config, files, signal);
  else call = await albumOf(message, config, files, signal);
  const fields = { chat_id: message.to, ...call.fields };
  const isAlbum = call.method === 'sendMediaGroup';
  const hasText = fields.text !== undefined || fields.caption !== undefined;
  if (config.parseMode !== undefined && !isAlbum && hasText) fields.parse_mode = config.parseMode;
  if (message.thread !== undefined) {
    if (!TOPIC.test(message.thread)) throw invalid('thread is the number of a topic of a forum.');
    fields.message_thread_id = Number(message.thread);
  }
  if (message.buttons !== undefined && !isAlbum) fields.reply_markup = keyboardOf(message.buttons);
  // A message of low priority comes without a sound.
  if (message.priority === 'low') fields.disable_notification = true;
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      fields[name] = message.payload[name];
    }
  }
  return { method: call.method, body: bodyOf(fields, files) };
};

module.exports = { convertMessage };
