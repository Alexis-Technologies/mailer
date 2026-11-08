// Not ported: a message of Messenger or of Instagram as the body of the Send
// API of Meta (https://developers.facebook.com/docs/messenger-platform/reference/send-api):
// a text, one attachment at a URL or of an id, buttons as a button template
// of Messenger or as the quick replies of Instagram, a response within the
// 24 hours of the last message of the user unless the payload tags it, and
// the correlation id as the `metadata` of the message, which its echo gives
// back. thinwrap and visulima have neither channel.

const { Buffer } = require('node:buffer');
const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');

const MAX_TEXT = 2000;
const MAX_INSTAGRAM_BYTES = 1000;
const MAX_TEMPLATE_TEXT = 640;
const MAX_BUTTONS = 3;
const MAX_QUICK_REPLIES = 13;
const MAX_TITLE = 20;
const MAX_METADATA = 1000;
const OWN_FIELDS = new Set(['recipient']);
const KINDS = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
];

const labelOf = (channel) => (channel === 'instagram' ? 'Instagram' : 'Messenger');

const kindOf = (medium) => {
  const type = medium.contentType ?? '';
  for (const [prefix, kind] of KINDS) {
    if (type.startsWith(prefix)) return kind;
  }
  return 'file';
};

/**
 * The body of a message of Messenger or Instagram.
 *
 * @param message The message, of `createChannelMessage`.
 * @returns The body of `POST /{page-id}/messages`.
 * @throws {InvalidMessageError} If the Send API would refuse it.
 * @throws {RefusalError} If it holds what the channel cannot send.
 * @internal
 */
const messengerBodyOf = (message) => {
  const label = labelOf(message.channel);
  const invalid = (text) => new InvalidMessageError(`${label}: ${text}`);
  const unsupported = (text) => new RefusalError(`${label}: ${text}`);
  const isInstagram = message.channel === 'instagram';
  const sent = {};
  const hasMedia = message.media !== undefined && message.media.length > 0;
  if (hasMedia) {
    if (message.media.length > 1) throw unsupported('a message carries one attachment.');
    if (message.text !== undefined) throw unsupported('a message carries a text or an attachment.');
    const medium = message.media[0];
    if (medium.content !== undefined) throw unsupported('an attachment is a URL or an id.');
    sent.attachment = {
      type: kindOf(medium),
      payload: medium.url === undefined ? { attachment_id: medium.id } : { url: medium.url },
    };
  } else if (message.text !== undefined && message.text !== '') {
    // Instagram takes 1000 bytes of UTF-8, Messenger 2000 characters.
    if (
      isInstagram
        ? Buffer.byteLength(message.text) > MAX_INSTAGRAM_BYTES
        : message.text.length > MAX_TEXT
    ) {
      throw invalid(
        isInstagram
          ? `the text is more than the ${MAX_INSTAGRAM_BYTES} bytes of Instagram.`
          : `the text is more than ${MAX_TEXT} characters.`,
      );
    }
    sent.text = message.text;
  }
  if (message.buttons !== undefined) {
    for (const button of message.buttons) {
      if (button.text.length > MAX_TITLE) {
        throw invalid(`the text of a button is more than ${MAX_TITLE} characters.`);
      }
      if (button.type === 'call') throw unsupported('a button cannot call a phone.');
    }
    if (isInstagram) {
      // Instagram takes quick replies, which reply alone, under a text.
      if (sent.text === undefined) throw invalid('a message with buttons needs a text.');
      if (message.buttons.length > MAX_QUICK_REPLIES) {
        throw invalid(`a message holds ${MAX_QUICK_REPLIES} quick replies at most.`);
      }
      const replies = [];
      for (const button of message.buttons) {
        if (button.type !== 'reply') throw unsupported('a button of Instagram is a quick reply.');
        replies.push({ content_type: 'text', title: button.text, payload: button.id });
      }
      sent.quick_replies = replies;
    } else {
      if (sent.text === undefined) throw invalid('a message with buttons needs a text.');
      if (sent.text.length > MAX_TEMPLATE_TEXT) {
        throw invalid(`a text with buttons is more than ${MAX_TEMPLATE_TEXT} characters.`);
      }
      if (message.buttons.length > MAX_BUTTONS) {
        throw invalid(`a message holds ${MAX_BUTTONS} buttons at most.`);
      }
      const buttons = [];
      for (const button of message.buttons) {
        buttons.push(
          button.type === 'url'
            ? { type: 'web_url', url: button.url, title: button.text }
            : { type: 'postback', title: button.text, payload: button.id },
        );
      }
      sent.attachment = {
        type: 'template',
        payload: { template_type: 'button', text: sent.text, buttons },
      };
      delete sent.text;
    }
  }
  const correlationId = message.metadata?.correlationId;
  if (correlationId !== undefined && correlationId.length <= MAX_METADATA) {
    sent.metadata = correlationId;
  }
  const body = { recipient: { id: message.to }, messaging_type: 'RESPONSE', message: sent };
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      body[name] = message.payload[name];
    }
  }
  if (sent.text === undefined && sent.attachment === undefined && body.message === sent) {
    throw invalid('a message needs a text or an attachment.');
  }
  return body;
};

module.exports = { messengerBodyOf };
