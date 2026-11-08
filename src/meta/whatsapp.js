// Ported from @thinwrap/notifications v1.2.0 (src/providers/whatsapp-business/whatsapp-business.connector.ts):
// a message of WhatsApp as the body of the Cloud API, a text, a template or
// an interactive message.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: a body of `type: 'template'` without its template,
// which thinwrap sent for Meta to refuse, fails before any request (T10); a
// medium, buttons, and the correlation id as `biz_opaque_callback_data`,
// which the webhooks of its statuses give back, are written; and the limits
// of the Cloud API are checked before the request.

const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');

const MAX_TEXT = 4096;
const MAX_CAPTION = 1024;
const MAX_REPLY_BUTTONS = 3;
const MAX_BUTTON_TITLE = 20;
const MAX_INTERACTIVE_BODY = 1024;
const MAX_CALLBACK_DATA = 512;
const OWN_FIELDS = new Set(['messaging_product', 'to']);
// The kinds of a medium by its type: a picture, a video, an audio, or a
// document for any other.
const KINDS = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
];

const invalid = (message) => new InvalidMessageError(`WhatsApp: ${message}`);
const unsupported = (message) => new RefusalError(`WhatsApp: ${message}`);

const kindOf = (medium) => {
  const type = medium.contentType ?? '';
  for (const [prefix, kind] of KINDS) {
    if (type.startsWith(prefix)) return kind;
  }
  return 'document';
};

const mediumOf = (message) => {
  if (message.media.length > 1) throw unsupported('a message carries one medium.');
  const medium = message.media[0];
  if (medium.content !== undefined) {
    throw unsupported('a medium is a link or the id of a medium uploaded to WhatsApp.');
  }
  if (medium.caption !== undefined && message.text !== undefined) {
    throw invalid('the text is the caption of the medium: give one or the other.');
  }
  const kind = kindOf(medium);
  const object = medium.url === undefined ? { id: medium.id } : { link: medium.url };
  const caption = medium.caption ?? message.text;
  if (caption !== undefined && kind !== 'audio') {
    if (caption.length > MAX_CAPTION) {
      throw invalid(`a caption is more than ${MAX_CAPTION} characters.`);
    }
    object.caption = caption;
  }
  if (kind === 'document' && medium.filename !== undefined) object.filename = medium.filename;
  return { type: kind, [kind]: object };
};

// Buttons as an interactive message: up to three replies, or one link.
const interactiveOf = (message) => {
  const text = message.text;
  if (text === undefined || text === '') throw invalid('a message with buttons needs a text.');
  if (text.length > MAX_INTERACTIVE_BODY) {
    throw invalid(`a text with buttons is more than ${MAX_INTERACTIVE_BODY} characters.`);
  }
  const { buttons } = message;
  for (const button of buttons) {
    if (button.text.length > MAX_BUTTON_TITLE) {
      throw invalid(`the text of a button is more than ${MAX_BUTTON_TITLE} characters.`);
    }
    if (button.type === 'call') throw unsupported('a button cannot call a phone.');
  }
  if (buttons.length === 1 && buttons[0].type === 'url') {
    return {
      type: 'cta_url',
      body: { text },
      action: {
        name: 'cta_url',
        parameters: { display_text: buttons[0].text, url: buttons[0].url },
      },
    };
  }
  const replies = [];
  for (const button of buttons) {
    if (button.type !== 'reply') throw unsupported('buttons are up to three replies, or one link.');
    replies.push({ type: 'reply', reply: { id: button.id, title: button.text } });
  }
  if (replies.length > MAX_REPLY_BUTTONS) {
    throw invalid(`a message holds ${MAX_REPLY_BUTTONS} reply buttons at most.`);
  }
  return { type: 'button', body: { text }, action: { buttons: replies } };
};

/**
 * The body of a message of WhatsApp.
 *
 * @param message The message, of `createChannelMessage`.
 * @returns The body of `POST /{phone-number-id}/messages`.
 * @throws {InvalidMessageError} If the Cloud API would refuse it.
 * @throws {RefusalError} If it holds what WhatsApp cannot send.
 * @internal
 */
const whatsappBodyOf = (message) => {
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: message.to.slice(1),
  };
  const hasMedia = message.media !== undefined && message.media.length > 0;
  if (message.template !== undefined) {
    if (hasMedia || message.buttons !== undefined) {
      throw unsupported('a template carries its media and buttons in its components.');
    }
    const template = { name: message.template.name, language: { code: message.template.language } };
    if (message.template.components !== undefined) {
      template.components = message.template.components;
    }
    body.type = 'template';
    body.template = template;
  } else if (message.buttons !== undefined) {
    if (hasMedia) throw unsupported('a message with buttons carries no medium.');
    body.type = 'interactive';
    body.interactive = interactiveOf(message);
  } else if (hasMedia) {
    Object.assign(body, mediumOf(message));
  } else if (message.text !== undefined && message.text !== '') {
    if (message.text.length > MAX_TEXT) {
      throw invalid(`the text is more than ${MAX_TEXT} characters.`);
    }
    body.type = 'text';
    body.text = { body: message.text };
  }
  const correlationId = message.metadata?.correlationId;
  if (correlationId !== undefined && correlationId.length <= MAX_CALLBACK_DATA) {
    body.biz_opaque_callback_data = correlationId;
  }
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      body[name] = message.payload[name];
    }
  }
  if (body.type === undefined) throw invalid('a message needs a text, a medium or a template.');
  // Before (T10): a type of template went without one, for Meta to refuse.
  if (body.type === 'template' && body.template === undefined) {
    throw invalid('a message of type template needs its template.');
  }
  return body;
};

module.exports = { whatsappBodyOf };
