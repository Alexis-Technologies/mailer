// Ported from @thinwrap/notifications v1.2.0 (src/providers/ms-teams/ms-teams.connector.ts):
// a message of Teams as the Adaptive Card of a webhook, in the envelope of an
// activity (`{ type: 'message', attachments: [{ contentType, content }] }`).
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: the same activity goes to a conversation of a bot,
// its text alone when it has no button or picture; a picture is an Image of
// the card and a button an action; a message over the 28 KB of Teams is
// refused before the request. visulima sent a MessageCard of the Office 365
// connectors, which the webhooks of Workflows that replace them do not
// render (V13).

const { Buffer } = require('node:buffer');
const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');

const CARD_TYPE = 'application/vnd.microsoft.card.adaptive';
const CARD_SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';
const MAX_BYTES = 28 * 1024;

const invalid = (message) => new InvalidMessageError(`Teams: ${message}`);
const unsupported = (message) => new RefusalError(`Teams: ${message}`);

const actionOf = (button) => {
  if (button.type === 'url') return { type: 'Action.OpenUrl', title: button.text, url: button.url };
  if (button.type === 'reply') {
    return { type: 'Action.Submit', title: button.text, data: { id: button.id } };
  }
  throw unsupported('a button of a card opens a link or submits its id.');
};

const cardOf = (message) => {
  const body = [];
  if (message.text !== undefined) body.push({ type: 'TextBlock', text: message.text, wrap: true });
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
    body.push(
      picture.caption === undefined
        ? { type: 'Image', url: picture.url }
        : { type: 'Image', url: picture.url, altText: picture.caption },
    );
  }
  const card = { type: 'AdaptiveCard', $schema: CARD_SCHEMA, version: '1.4', body };
  if (message.buttons !== undefined) {
    card.actions = [];
    for (const button of message.buttons) card.actions.push(actionOf(button));
  }
  return card;
};

const isMentioning = (mentions) =>
  mentions !== undefined &&
  (mentions.everyone === true || mentions.users?.length > 0 || mentions.roles?.length > 0);

/**
 * The activity of a message: to the webhook without `to`, or to the
 * conversation of a bot.
 *
 * @param message The message, of `createChannelMessage`.
 * @returns `{ toWebhook, body }`.
 * @throws {InvalidMessageError} If Teams would refuse it.
 * @throws {RefusalError} If it holds what the transport cannot send.
 * @internal
 */
const convertMessage = (message) => {
  if (message.channel !== 'teams') {
    throw unsupported(
      `the transport sends messages of Teams, not of ${message.channel ?? 'email'}.`,
    );
  }
  if (isMentioning(message.mentions)) {
    throw unsupported('a mention of Teams is an entity of the payload, with its <at> in the text.');
  }
  const toWebhook = message.to === undefined;
  const plain =
    !toWebhook &&
    message.buttons === undefined &&
    (message.media === undefined || message.media.length === 0);
  let body;
  if (plain) {
    body = { type: 'message' };
    if (message.text !== undefined) {
      body.text = message.text;
      body.textFormat = 'markdown';
    }
  } else {
    body = { type: 'message', attachments: [{ contentType: CARD_TYPE, content: cardOf(message) }] };
  }
  if (message.payload !== undefined) {
    for (const name in message.payload) body[name] = message.payload[name];
  }
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BYTES) {
    throw invalid(`the message is more than the ${MAX_BYTES} bytes of Teams.`);
  }
  return { toWebhook, body };
};

module.exports = { convertMessage };
