// Ported from @thinwrap/notifications v1.2.0 (src/providers/google-chat/google-chat.connector.ts):
// a message of Google Chat as the body of spaces.messages.create, its text,
// its thread by its key, and its cards.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: `<users/all>`, which notifies a whole space, and a
// mention of a user the message does not name are broken with a zero-width
// space; a picture and links are a card of the message; a message over the
// 32,000 bytes of Chat is refused before the request.

const { Buffer } = require('node:buffer');
const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');

const MAX_BYTES = 32_000;
const USER_MENTION = /<users\/([^>\s]{1,128})>/g;
const SPACE = /^spaces\/[A-Za-z0-9_-]{1,128}$/;

const invalid = (message) => new InvalidMessageError(`Google Chat: ${message}`);
const unsupported = (message) => new RefusalError(`Google Chat: ${message}`);

// The text with only the mentions the message allows: the whole space when
// `everyone`, the users it names.
const textOf = (text, mentions) => {
  const users = new Set(mentions?.users ?? []);
  return text.replace(USER_MENTION, (match, id) =>
    (id === 'all' ? mentions?.everyone === true : users.has(id)) ? match : `<​users/${id}>`,
  );
};

const widgetsOf = (message) => {
  const widgets = [];
  const media = message.media ?? [];
  if (media.length > 1) throw unsupported('a card carries one picture.');
  const [picture] = media;
  if (picture !== undefined) {
    if (
      picture.url === undefined ||
      (picture.contentType !== undefined && !picture.contentType.startsWith('image/'))
    ) {
      throw unsupported('a medium is a picture at its URL.');
    }
    widgets.push({
      image:
        picture.caption === undefined
          ? { imageUrl: picture.url }
          : { imageUrl: picture.url, altText: picture.caption },
    });
  }
  if (message.buttons !== undefined) {
    const buttons = [];
    for (const button of message.buttons) {
      if (button.type !== 'url') {
        throw unsupported('a button of a message opens a link; an action is an app of its own.');
      }
      buttons.push({ text: button.text, onClick: { openLink: { url: button.url } } });
    }
    widgets.push({ buttonList: { buttons } });
  }
  return widgets;
};

/**
 * The body of a message: to the webhook without `to`, or to a space of the
 * app.
 *
 * @param message The message, of `createChannelMessage`.
 * @returns `{ toWebhook, body }`.
 * @throws {InvalidMessageError} If Chat would refuse it.
 * @throws {RefusalError} If it holds what the transport cannot send.
 * @internal
 */
const convertMessage = (message) => {
  if (message.channel !== 'google-chat') {
    throw unsupported(
      `the transport sends messages of Google Chat, not of ${message.channel ?? 'email'}.`,
    );
  }
  // The space goes into the path of the request the token of the app goes
  // with: an id of a space alone, never a path, a query or a fragment.
  if (message.to !== undefined && !SPACE.test(message.to)) {
    throw invalid('the recipient of a Chat app is a space: spaces/ and its id.');
  }
  const body = {};
  if (message.text !== undefined) body.text = textOf(message.text, message.mentions);
  const widgets = widgetsOf(message);
  if (widgets.length > 0) body.cardsV2 = [{ cardId: 'message', card: { sections: [{ widgets }] } }];
  if (message.thread !== undefined) body.thread = { threadKey: message.thread };
  if (message.payload !== undefined) {
    for (const name in message.payload) body[name] = message.payload[name];
  }
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BYTES) {
    throw invalid(`the message is more than the ${MAX_BYTES} bytes of Chat.`);
  }
  return { toWebhook: message.to === undefined, body };
};

module.exports = { convertMessage };
