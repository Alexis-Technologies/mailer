// Not ported: the entry of ./channels, the messages of the channels other than
// email: their builder and checks, the phone numbers of E.164, the segments
// of an SMS, and the escaping of the markup of the chats. Its modules live in
// internal/channel/, which the transports of the channels require.

const {
  checkChannelMessage,
  createChannelMessage,
  isChannelMessage,
} = require('../internal/channel/message.js');
const {
  escapeDiscordMarkdown,
  escapeSlackText,
  escapeTelegramHtml,
  neutralizeMentions,
} = require('../internal/channel/markup.js');
const { isE164, normalizePhone } = require('../internal/channel/phone.js');
const { countSegments } = require('../internal/channel/segments.js');

module.exports = {
  checkChannelMessage,
  countSegments,
  createChannelMessage,
  escapeDiscordMarkdown,
  escapeSlackText,
  escapeTelegramHtml,
  isChannelMessage,
  isE164,
  neutralizeMentions,
  normalizePhone,
};
