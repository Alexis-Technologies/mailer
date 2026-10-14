// Ported from upyo v0.7.0 (packages/sendgrid/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createCalendarAttachment } = require('../core/calendar.js');
const { combineSignals } = require('../core/abort-signal.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { resolveThreadingHeaders } = require('../core/message-id.js');

/**
 * Converts a Upyo Message to SendGrid API JSON format.
 *
 * This function transforms the standardized Upyo message format into
 * the specific format expected by the SendGrid API.
 *
 * @param message - The Upyo message to convert
 * @param config - The resolved SendGrid configuration
 * @returns Promise that resolves to a SendGrid mail object
 * @throws {TypeError} If the message carries an invalid message identifier.
 *
 * @example
 * ```typescript
 * const mailData = await convertMessage(message, config);
 * const response = await httpClient.sendMessage(mailData);
 * ```
 */
const convertMessage = async (message, config, signal) => {
  // A transport that cannot compose a `text/calendar` alternative carries the
  // scheduling payload as an *invite.ics* part instead, ahead of the caller's
  // own files so that a client looking for the first calendar part finds it.
  const attachments =
    message.calendar == null
      ? message.attachments
      : [createCalendarAttachment(message.calendar), ...message.attachments];

  const sendGridMail = {
    personalizations: [],
    from: formatAddress(message.sender),
  };

  // Create personalization object
  const personalization = {
    to: message.recipients.map(formatAddress),
    subject: message.subject,
  };

  // Add CC recipients if any
  if (message.ccRecipients.length > 0) {
    personalization.cc = message.ccRecipients.map(formatAddress);
  }

  // Add BCC recipients if any
  if (message.bccRecipients.length > 0) {
    personalization.bcc = message.bccRecipients.map(formatAddress);
  }

  sendGridMail.personalizations.push(personalization);

  // Reply-to handling
  if (message.replyRecipients.length > 0) {
    if (message.replyRecipients.length === 1) {
      sendGridMail.reply_to = formatAddress(message.replyRecipients[0]);
    } else {
      sendGridMail.reply_to_list = message.replyRecipients.map(formatAddress);
    }
  }

  // Content
  const content = [];

  if ('html' in message.content) {
    if (message.content.text) {
      content.push({
        type: 'text/plain',
        value: message.content.text,
      });
    }
    content.push({
      type: 'text/html',
      value: message.content.html,
    });
  } else {
    content.push({
      type: 'text/plain',
      value: message.content.text,
    });
  }

  sendGridMail.content = content;

  // Priority handling (using custom headers)
  if (message.priority !== 'normal') {
    const headers = {};

    switch (message.priority) {
      case 'high':
        headers['X-Priority'] = '1';
        headers['X-MSMail-Priority'] = 'High';
        headers['Importance'] = 'High';
        break;
      case 'low':
        headers['X-Priority'] = '5';
        headers['X-MSMail-Priority'] = 'Low';
        headers['Importance'] = 'Low';
        break;
    }

    sendGridMail.headers = { ...sendGridMail.headers, ...headers };
  }

  // Tags (categories in SendGrid)
  if (message.tags.length > 0) {
    sendGridMail.categories = [...message.tags];
  }

  // Custom headers
  const customHeaders = {};
  // Reply threading comes from the typed fields when the message defines them,
  // and from a custom header otherwise.  A field the message owns but left
  // empty writes nothing, which is how a caller drops an inherited header.
  const threading = resolveThreadingHeaders(message);
  const ownedHeaders = new Set([...threading.keys()].map((name) => name.toLowerCase()));

  for (const [key, value] of message.headers.entries()) {
    // Skip standard headers that are handled separately
    if (!isStandardHeader(key) && !ownedHeaders.has(key.toLowerCase())) {
      customHeaders[key] = value;
    }
  }
  for (const [name, value] of threading) {
    if (value != null) customHeaders[name] = value;
  }

  if (Object.keys(customHeaders).length > 0) {
    sendGridMail.headers = { ...sendGridMail.headers, ...customHeaders };
  }

  // Attachments
  if (attachments.length > 0) {
    const cancellation = new AbortController();
    const combined = combineSignals(cancellation.signal, signal);
    try {
      sendGridMail.attachments = await Promise.all(
        attachments.map((attachment) => convertAttachment(attachment, combined.signal)),
      );
    } finally {
      cancellation.abort();
      combined.cleanup();
    }
  }

  // Tracking settings
  const trackingSettings = {};

  if (config.clickTracking !== undefined) {
    trackingSettings.click_tracking = {
      enable: config.clickTracking,
      enable_text: config.clickTracking,
    };
  }

  if (config.openTracking !== undefined) {
    trackingSettings.open_tracking = {
      enable: config.openTracking,
    };
  }

  if (config.subscriptionTracking !== undefined) {
    trackingSettings.subscription_tracking = {
      enable: config.subscriptionTracking,
    };
  }

  if (config.googleAnalytics !== undefined) {
    trackingSettings.ganalytics = {
      enable: config.googleAnalytics,
    };
  }

  if (Object.keys(trackingSettings).length > 0) {
    sendGridMail.tracking_settings = trackingSettings;
  }

  return sendGridMail;
};

/**
 * Formats an address for SendGrid API.
 *
 * @param address - The address to format
 * @returns Formatted address object
 */
const formatAddress = (address) => {
  const result = {
    email: address.address,
  };

  if (address.name) {
    result.name = address.name;
  }

  return result;
};

/**
 * Converts a Upyo attachment to SendGrid format.
 *
 * @param attachment - The attachment to convert
 * @returns Promise that resolves to a SendGrid attachment object
 */
const convertAttachment = async (attachment, signal) => {
  // Get the content as Uint8Array then convert to base64
  const contentBytes = await readAttachmentContent(attachment.content, signal);

  // Convert to base64
  const parts = [];
  for (let offset = 0; offset < contentBytes.length; offset += 8192) {
    parts.push(String.fromCharCode(...contentBytes.subarray(offset, offset + 8192)));
  }
  const base64Content = btoa(parts.join(''));

  const sendGridAttachment = {
    content: base64Content,
    filename: attachment.filename,
  };

  if (attachment.contentType) {
    sendGridAttachment.type = attachment.contentType;
  }

  if (attachment.inline && attachment.contentId) {
    sendGridAttachment.disposition = 'inline';
    sendGridAttachment.content_id = attachment.contentId;
  } else {
    sendGridAttachment.disposition = 'attachment';
  }

  return sendGridAttachment;
};

/**
 * Checks if a header is a standard email header that should not be added as custom header.
 *
 * @param headerName - The header name to check
 * @returns True if it's a standard header
 */
const isStandardHeader = (headerName) => {
  const standardHeaders = [
    'from',
    'to',
    'cc',
    'bcc',
    'reply-to',
    'subject',
    'date',
    'message-id',
    'content-type',
    'content-transfer-encoding',
    'mime-version',
    'x-priority',
    'x-msmail-priority',
    'importance',
  ];

  return standardHeaders.includes(headerName.toLowerCase());
};

module.exports = { convertMessage };
