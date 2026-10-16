// Ported from upyo v0.7.0 (packages/ses/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { formatQuotedMailbox: formatAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { toBase64 } = require('../internal/base64.js');
const {
  convertAttachments,
  formatAddresses,
  withCalendarAttachment,
} = require('../internal/provider.js');

const convertMessage = async (message, config, signal) => {
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

  const attachments = withCalendarAttachment(message);

  if (attachments.length > 0) {
    content.Attachments = await convertAttachments(attachments, convertAttachment, signal);
  }

  return content;
};

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
