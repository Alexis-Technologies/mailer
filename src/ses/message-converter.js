// Ported from upyo v0.7.0 (packages/ses/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { Buffer } = require('node:buffer');
const { formatQuotedMailbox: formatAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { toBase64 } = require('../internal/base64.js');
const { refuseScheduledAt } = require('../internal/schedule.js');
const {
  convertAttachments,
  formatAddresses,
  visitCustomHeaders,
  withCalendarAttachment,
} = require('../internal/provider.js');

// The header fields SES sets itself and refuses in Headers, lower-cased.
const SES_HEADERS = new Set([
  'bcc',
  'cc',
  'content-disposition',
  'content-type',
  'date',
  'from',
  'message-id',
  'mime-version',
  'reply-to',
  'return-path',
  'subject',
  'to',
]);
// The most fields SES takes in Headers, and the longest field it takes.
const MAX_SES_HEADERS = 15;
const MAX_SES_HEADER_LENGTH = 996;

const convertMessage = async (message, config, signal) => {
  refuseScheduledAt(message, 'ses');
  const destination = {};

  if (message.recipients.length > 0) {
    destination.ToAddresses = formatAddresses(message.recipients, formatAddress);
  }

  if (message.ccRecipients.length > 0) {
    destination.CcAddresses = formatAddresses(message.ccRecipients, formatAddress);
  }

  if (message.bccRecipients.length > 0) {
    destination.BccAddresses = formatAddresses(message.bccRecipients, formatAddress);
  }

  const sesMessage = {
    Destination: destination,
    Content: {},
    FromEmailAddress: formatAddress(message.sender),
  };

  if (message.replyRecipients.length > 0) {
    sesMessage.ReplyToAddresses = formatAddresses(message.replyRecipients, formatAddress);
  }

  if (config.configurationSetName) {
    sesMessage.ConfigurationSetName = config.configurationSetName;
  }

  sesMessage.Content.Simple = await createSimpleContent(message, signal);

  const tags = [];

  if (message.tags.length > 0) {
    for (const tag of message.tags) {
      tags.push({ Name: 'category', Value: tag });
    }
  }

  if (message.priority !== 'normal') {
    tags.push({ Name: 'priority', Value: message.priority });
  }

  for (const name in config.defaultTags) {
    if (Object.hasOwn(config.defaultTags, name)) {
      tags.push({ Name: name, Value: config.defaultTags[name] });
    }
  }

  if (tags.length > 0) {
    sesMessage.Tags = tags;
  }

  return sesMessage;
};

const createSimpleContent = async (message, signal) => {
  const content = {
    Subject: {
      Data: message.subject,
      Charset: 'UTF-8',
    },
    Body: {},
  };

  if ('html' in message.content) {
    content.Body.Html = {
      Data: message.content.html,
      Charset: 'UTF-8',
    };

    if (message.content.text) {
      content.Body.Text = {
        Data: message.content.text,
        Charset: 'UTF-8',
      };
    }
  } else {
    content.Body.Text = {
      Data: message.content.text,
      Charset: 'UTF-8',
    };
  }

  const headers = convertHeaders(message);
  if (headers.length > 0) content.Headers = headers;

  const attachments = withCalendarAttachment(message);

  if (attachments.length > 0) {
    content.Attachments = await convertAttachments(attachments, convertAttachment, signal);
  }

  return content;
};

/**
 * The custom and threading header fields of a message as SES takes them in
 * Headers: the fields it sets itself left out, a value outside printable
 * ASCII in RFC 2047 encoded words.
 *
 * @param message The message being converted.
 * @returns The fields, as `Name` and `Value`.
 * @throws {RangeError} If there are more fields than SES takes, or one is
 * longer than it takes.
 */
const convertHeaders = (message) => {
  const headers = [];
  visitCustomHeaders(
    message,
    (name) => SES_HEADERS.has(name.toLowerCase()),
    (name, value) => {
      if (value === '') return;
      const encoded = encodeHeaderValue(value);
      if (name.length + encoded.length > MAX_SES_HEADER_LENGTH) {
        throw new RangeError(`SES takes a header field of at most 996 characters: ${name}`);
      }
      headers.push({ Name: name, Value: encoded });
    },
  );
  if (headers.length > MAX_SES_HEADERS) {
    throw new RangeError(
      `SES takes at most ${MAX_SES_HEADERS} custom header fields, and the message has ${headers.length}.`,
    );
  }
  return headers;
};

// A value of Latin-1 text, as a Headers object holds it, in encoded words of
// at most 45 bytes of UTF-8 each when it is not printable ASCII.
const encodeHeaderValue = (value) => {
  if (/^[ -~]*$/.test(value)) return value;
  let encoded = '';
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const length = value.charCodeAt(i) < 0x80 ? 1 : 2;
    if (bytes + length > 45) {
      encoded += `${encoded === '' ? '' : ' '}${encodeWord(value.slice(start, i))}`;
      start = i;
      bytes = 0;
    }
    bytes += length;
  }
  return `${encoded === '' ? '' : `${encoded} `}${encodeWord(value.slice(start))}`;
};

const encodeWord = (text) => `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;

const convertAttachment = async (attachment, signal) => {
  const contentBytes = await readAttachmentContent(attachment.content, signal);
  const converted = {
    FileName: attachment.filename,
    ContentType: attachment.contentType || 'application/octet-stream',
    ContentDisposition: attachment.inline ? 'INLINE' : 'ATTACHMENT',
    ContentTransferEncoding: 'BASE64',
    RawContent: toBase64(contentBytes),
  };
  // An empty content ID is how Upyo spells "this part has none", so it is left
  // out rather than sent as an empty header value.
  if (attachment.contentId !== '') {
    converted.ContentId = attachment.contentId;
  }
  return converted;
};

module.exports = { convertMessage };
