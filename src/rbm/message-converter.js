// Not ported: a message of RCS as the AgentMessage of the RBM API: its text,
// one medium by URL (a standalone rich card when it has a text too), its
// buttons as suggestions, its expiry, and the payload over them; what the
// API would refuse is refused before the request.

const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');

const MAX_TEXT = 3072;
const MAX_CARD_TEXT = 2000;
const MAX_SUGGESTIONS = 11;
const MAX_CARD_SUGGESTIONS = 4;
const MAX_SUGGESTION_TEXT = 25;

const invalid = (message) => new InvalidMessageError(`RBM: ${message}`);
const unsupported = (message) => new RefusalError(`RBM: ${message}`);
const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const merge = (base, over) => {
  const merged = { ...base };
  for (const key in over) {
    const value = over[key];
    merged[key] =
      isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
  }
  return merged;
};

// A button as a suggestion: a reply its id as postback, a link or a call
// as an action.
const suggestionOf = (button) => {
  if (button.text.length > MAX_SUGGESTION_TEXT) {
    throw invalid(`the text of a button is more than ${MAX_SUGGESTION_TEXT} characters.`);
  }
  if (button.type === 'reply') return { reply: { text: button.text, postbackData: button.id } };
  if (button.type === 'url') {
    return {
      action: { text: button.text, postbackData: button.url, openUrlAction: { url: button.url } },
    };
  }
  return {
    action: {
      text: button.text,
      postbackData: button.phone,
      dialAction: { phoneNumber: button.phone },
    },
  };
};

const contentOf = (message) => {
  const media = message.media ?? [];
  if (media.length > 1) throw unsupported('a message carries one medium.');
  const [medium] = media;
  if (medium !== undefined && medium.url === undefined) {
    throw unsupported('a medium goes by its URL; a file uploaded to RBM by the payload.');
  }
  const text = message.text;
  if (medium === undefined) {
    if (text === undefined) return undefined;
    if (text.length > MAX_TEXT) throw invalid(`the text is more than ${MAX_TEXT} characters.`);
    return { text };
  }
  if (text === undefined) return { contentInfo: { fileUrl: medium.url } };
  if (text.length > MAX_CARD_TEXT) {
    throw invalid(`the text of a card is more than ${MAX_CARD_TEXT} characters.`);
  }
  return {
    richCard: {
      standaloneCard: {
        cardOrientation: 'VERTICAL',
        cardContent: {
          description: text,
          media: { height: 'MEDIUM', contentInfo: { fileUrl: medium.url } },
        },
      },
    },
  };
};

/**
 * The AgentMessage of a message of RCS.
 *
 * @param message The message, of `createChannelMessage`.
 * @returns The body of agentMessages.create.
 * @throws {InvalidMessageError} If the API would refuse it.
 * @throws {RefusalError} If it holds what the transport cannot send.
 * @internal
 */
const convertMessage = (message) => {
  if (message.channel !== 'rcs') {
    throw unsupported(`the transport sends RCS, not messages of ${message.channel ?? 'email'}.`);
  }
  const content = contentOf(message) ?? {};
  if (message.buttons !== undefined) {
    const card = content.richCard?.standaloneCard.cardContent;
    const limit = card === undefined ? MAX_SUGGESTIONS : MAX_CARD_SUGGESTIONS;
    if (message.buttons.length > limit) {
      throw invalid(`a ${card === undefined ? 'message' : 'card'} has ${limit} buttons at most.`);
    }
    const suggestions = [];
    for (const button of message.buttons) suggestions.push(suggestionOf(button));
    if (card === undefined) content.suggestions = suggestions;
    else card.suggestions = suggestions;
  }
  let body = { contentMessage: content };
  if (message.expiresAt !== undefined) body.expireTime = message.expiresAt.toISOString();
  if (message.payload !== undefined) body = merge(body, message.payload);
  const sent = body.contentMessage;
  if (
    !isPlainObject(sent) ||
    (sent.text === undefined &&
      sent.fileUrl === undefined &&
      sent.richCard === undefined &&
      sent.contentInfo === undefined &&
      sent.uploadedRbmFile === undefined)
  ) {
    throw invalid('a message needs a text, a medium or a payload with its content.');
  }
  return body;
};

module.exports = { convertMessage };
