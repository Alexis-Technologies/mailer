// Not ported: a message of Slack as the body of chat.postMessage of the Web
// API (https://api.slack.com/methods/chat.postMessage), or of an incoming
// webhook without `to`: its text in mrkdwn, its mentions of a whole channel,
// of users and of groups neutralized unless the message names them, its
// buttons and pictures as Block Kit, and the limits of Slack checked before
// the request.

const { InvalidMessageError } = require('../internal/channel/failure.js');
const { neutralizeMentions } = require('../internal/channel/markup.js');
const { RefusalError } = require('../internal/refusal.js');

const MAX_TEXT = 40000;
const MAX_SECTION = 3000;
const MAX_BUTTON_TEXT = 75;
const MAX_ACTIONS = 25;
// The fields of a body the transport writes, which a payload may not.
const OWN_FIELDS = new Set(['channel']);
// `<@U123>`, `<@W123|name>` and `<!subteam^S123>`: a user, a group.
const USER_MENTION = /<@([UW][A-Z0-9]+)(\|[^>]*)?>/g;
const GROUP_MENTION = /<!subteam\^([A-Z0-9]+)(\|[^>]*)?>/g;

const invalid = (message) => new InvalidMessageError(`Slack: ${message}`);
const unsupported = (message) => new RefusalError(`Slack: ${message}`);

// The text with only the mentions the message allows: a whole channel when
// `everyone`, the users and groups it names.
const textOf = (text, mentions) => {
  const allowed = mentions?.everyone === true ? text : neutralizeMentions(text);
  const users = new Set(mentions?.users ?? []);
  const groups = new Set(mentions?.roles ?? []);
  return allowed
    .replace(USER_MENTION, (match, id, label) =>
      users.has(id) ? match : `&lt;@${id}${label ?? ''}&gt;`,
    )
    .replace(GROUP_MENTION, (match, id, label) =>
      groups.has(id) ? match : `&lt;!subteam^${id}${label ?? ''}&gt;`,
    );
};

const plain = (text) => ({ type: 'plain_text', text, emoji: true });

const buttonOf = (button, index) => {
  if (button.text.length > MAX_BUTTON_TEXT) {
    throw invalid(`the text of a button is more than ${MAX_BUTTON_TEXT} characters.`);
  }
  if (button.type === 'url') return { type: 'button', text: plain(button.text), url: button.url };
  if (button.type === 'reply') {
    return {
      type: 'button',
      text: plain(button.text),
      value: button.id,
      action_id: `${button.id}:${index}`,
    };
  }
  throw unsupported('a button cannot call a phone.');
};

// The pictures of the message, at their URL; Slack takes no file in a post.
const imagesOf = (media) => {
  const blocks = [];
  for (const medium of media) {
    if (medium.url === undefined || !(medium.contentType ?? 'image/').startsWith('image/')) {
      throw unsupported('a medium is a picture at its URL; Slack takes no file in a post.');
    }
    blocks.push({
      type: 'image',
      image_url: medium.url,
      alt_text: medium.caption ?? medium.filename ?? 'image',
    });
  }
  return blocks;
};

// The blocks of a message with buttons or pictures: its text as a section,
// then its pictures, then its buttons.
const blocksOf = (message, text) => {
  const blocks = [];
  if (text !== undefined && text !== '') {
    if (text.length > MAX_SECTION) {
      throw invalid(
        `a text with buttons or pictures is ${text.length} characters, more than ${MAX_SECTION}.`,
      );
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text } });
  }
  if (message.media !== undefined) {
    for (const block of imagesOf(message.media)) blocks.push(block);
  }
  if (message.buttons !== undefined) {
    if (message.buttons.length > MAX_ACTIONS) {
      throw invalid(`a message holds ${MAX_ACTIONS} buttons at most.`);
    }
    const elements = [];
    for (let i = 0; i < message.buttons.length; i++) elements.push(buttonOf(message.buttons[i], i));
    blocks.push({ type: 'actions', elements });
  }
  return blocks;
};

/**
 * The body of a message of Slack, and whether it goes to the Web API (`to`)
 * or to the webhook.
 *
 * @param message The message, of `createChannelMessage`.
 * @returns `{ toWebhook, body }`.
 * @throws {InvalidMessageError} If Slack would refuse it.
 * @throws {RefusalError} If it holds what Slack cannot post.
 * @internal
 */
const convertMessage = (message) => {
  if (message.channel !== 'slack') {
    throw unsupported(
      `the transport sends messages of slack, not of ${message.channel ?? 'email'}.`,
    );
  }
  const text = message.text === undefined ? undefined : textOf(message.text, message.mentions);
  if (text !== undefined && text.length > MAX_TEXT) {
    throw invalid(`the text is ${text.length} characters, more than ${MAX_TEXT}.`);
  }
  const body = {};
  if (message.to !== undefined) body.channel = message.to;
  if (text !== undefined) body.text = text;
  const hasMedia = message.media !== undefined && message.media.length > 0;
  if (hasMedia || message.buttons !== undefined) {
    if (message.payload?.blocks !== undefined) {
      throw invalid('give the buttons and pictures in the blocks of the payload, or neither.');
    }
    body.blocks = blocksOf(message, text);
  }
  if (message.thread !== undefined) body.thread_ts = message.thread;
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      body[name] = message.payload[name];
    }
  }
  if (body.text === undefined && body.blocks === undefined && body.attachments === undefined) {
    throw invalid('a message needs a text, blocks or attachments.');
  }
  return { toWebhook: message.to === undefined, body };
};

module.exports = { convertMessage };
