// Ported from upyo v0.7.0 (packages/opentelemetry/src/attributes.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { redactMessageRecipient } = require('../internal/channel/recipient.js');
const { countSegments } = require('../internal/channel/segments.js');
const { estimateMessageSize } = require('./message-size.js');

/**
 * Email attribute extractor class for generating OpenTelemetry attributes.
 * Handles extraction of message metadata, error information, and transport details
 * while respecting privacy settings for sensitive data.
 *
 * This class provides methods for extracting attributes from email messages,
 * batch operations, and errors, making them suitable for use in OpenTelemetry
 * spans and metrics.
 *
 * @example
 * ```typescript
 * import { EmailAttributeExtractor } from "@alexify/mailer/otel";
 *
 * const extractor = new EmailAttributeExtractor(
 *   "smtp",           // transport name
 *   false,            // don't record sensitive data
 *   "2.1.0"          // transport version
 * );
 *
 * // Extract attributes from a message
 * const messageAttrs = extractor.extractMessageAttributes(message);
 *
 * // Extract attributes from batch operations
 * const batchAttrs = extractor.extractBatchAttributes(messages, batchSize);
 *
 * // Extract attributes from errors
 * const errorAttrs = extractor.extractErrorAttributes(error, "network");
 * ```
 */
// The beginnings of an error message that describe the transport rather than
// a recipient.
const SAFE_ERROR_MESSAGE =
  /^(?:timeout|connection|network|dns|rate limit|quota exceeded|service unavailable|internal server error|bad gateway|gateway timeout)/i;

class EmailAttributeExtractor {
  recordSensitiveData;
  transportName;
  transportVersion;

  constructor(transportName, recordSensitiveData = false, transportVersion) {
    this.transportName = transportName;
    this.recordSensitiveData = recordSensitiveData;
    this.transportVersion = transportVersion;
  }

  /**
   * Extracts attributes for a single message send operation: those of email
   * for an email, of `extractChannelAttributes` for a message of a channel.
   */
  extractMessageAttributes(message, messageSize = estimateMessageSize(message)) {
    if ((message.channel ?? 'email') !== 'email') {
      return this.extractChannelAttributes(message, messageSize);
    }
    const attributes = {
      // General operation attributes (following OTel patterns)
      'operation.name': 'email.send',
      'operation.type': 'email',

      // Email-specific attributes (new namespace)
      'email.to.count': message.recipients.length,
      'email.cc.count': message.ccRecipients.length,
      'email.bcc.count': message.bccRecipients.length,
      'email.attachments.count': message.attachments.length,
      'email.priority': message.priority,
      'email.tags': JSON.stringify(message.tags),

      // Upyo-specific attributes (vendor namespace)
      'mailer.channel': 'email',
      'mailer.transport.name': this.transportName,
      'mailer.retry.count': 0, // Will be updated by transport if retries occur
      'mailer.batch.size': 1,
    };

    // Add transport version if available
    if (this.transportVersion) {
      attributes['mailer.transport.version'] = this.transportVersion;
    }
    if (message.tenantId !== undefined) attributes['mailer.tenant.id'] = message.tenantId;

    // Conditionally add sensitive data
    if (this.recordSensitiveData) {
      attributes['email.from.address'] = message.sender.address;
      attributes['email.subject.length'] = message.subject.length;
    } else {
      // Redacted versions
      attributes['email.from.domain'] = this.extractDomain(message.sender.address);
      attributes['email.subject.length'] = message.subject.length;
    }

    // Content type detection
    attributes['email.content.type'] = this.detectContentType(message);

    // Calculate message size estimate
    attributes['email.message.size'] = messageSize;

    return attributes;
  }

  /**
   * Extracts attributes for the send of a message of a channel: its channel,
   * the length of its text, its media, the segments and the encoding of an
   * SMS as `countSegments` of `./channels` counts them, and its tenant; its
   * sender only when sensitive data is recorded, and its recipient never.
   */
  extractChannelAttributes(message, messageSize) {
    const channel = message.channel;
    const attributes = {
      'operation.name': `${channel}.send`,
      'operation.type': channel,
      'mailer.channel': channel,
      'mailer.priority': message.priority,
      'mailer.message.tags': JSON.stringify(message.tags),
      'mailer.message.text.length': message.text?.length ?? 0,
      'mailer.message.media.count': message.media?.length ?? 0,
      'mailer.message.size': messageSize,
      'mailer.transport.name': this.transportName,
      'mailer.retry.count': 0,
      'mailer.batch.size': 1,
    };
    if (this.transportVersion) attributes['mailer.transport.version'] = this.transportVersion;
    if (channel === 'sms' && message.text !== undefined) {
      const counted = countSegments(message.text);
      attributes['mailer.message.segments'] = counted.segments;
      attributes['mailer.message.encoding'] = counted.encoding;
    }
    if (this.recordSensitiveData && message.from !== undefined) {
      attributes['mailer.message.from'] = message.from;
    }
    if (message.tenantId !== undefined) attributes['mailer.tenant.id'] = message.tenantId;
    return attributes;
  }

  /**
   * Extracts attributes for the send of serialized MIME: its envelope and
   * size, with the sender's address under the same rule as a message's.
   */
  extractRawMessageAttributes(message, messageSize) {
    const from = message?.envelope?.from;
    const attributes = {
      'operation.name': 'email.send_raw',
      'operation.type': 'email',
      'mailer.channel': 'email',
      'email.to.count': message?.envelope?.to?.length ?? 0,
      'mailer.transport.name': this.transportName,
      'mailer.retry.count': 0,
      'mailer.batch.size': 1,
      'email.message.size': messageSize,
    };
    if (this.transportVersion) attributes['mailer.transport.version'] = this.transportVersion;
    if (typeof from === 'string') {
      if (this.recordSensitiveData) attributes['email.from.address'] = from;
      else attributes['email.from.domain'] = this.extractDomain(from);
    }
    return attributes;
  }

  /**
   * Extracts attributes for batch send operations, from the totals of the
   * messages the batch read: those of email for a batch of email (or of none),
   * and for a batch of a channel or of several (`totals.channel` `null`),
   * those of a batch of messages.
   */
  extractBatchAttributes(totals) {
    const channel = totals.channel;
    if (channel !== undefined && channel !== 'email') {
      const attributes = {
        'operation.name': `${channel ?? 'message'}.send_batch`,
        'operation.type': channel ?? 'message',
        'mailer.batch.size': totals.count,
        'mailer.batch.total_recipients': totals.recipients,
        'mailer.batch.total_media': totals.attachments,
        'mailer.batch.total_size': totals.size,
        'mailer.transport.name': this.transportName,
      };
      if (channel !== null) attributes['mailer.channel'] = channel;
      if (this.transportVersion) attributes['mailer.transport.version'] = this.transportVersion;
      return attributes;
    }
    const attributes = {
      // General operation attributes
      'operation.name': 'email.send_batch',
      'operation.type': 'email',

      // Batch-specific attributes
      'email.batch.size': totals.count,
      'email.batch.total_recipients': totals.recipients,
      'email.batch.total_attachments': totals.attachments,
      'email.batch.total_size': totals.size,

      // Upyo-specific attributes
      'mailer.channel': 'email',
      'mailer.transport.name': this.transportName,
      'mailer.batch.size': totals.count,
    };

    // Add transport version if available
    if (this.transportVersion) {
      attributes['mailer.transport.version'] = this.transportVersion;
    }

    return attributes;
  }

  // Dead upstream: the transport extracts its own network attributes.
  /* c8 ignore start */
  /**
   * Extracts network-related attributes from transport configuration.
   */
  extractNetworkAttributes(protocol, serverAddress, serverPort) {
    const attributes = {
      'network.protocol.name': protocol,
    };

    if (serverAddress) {
      attributes['server.address'] = serverAddress;
    }

    if (serverPort) {
      attributes['server.port'] = serverPort;
    }

    return attributes;
  }
  /* c8 ignore stop */

  /**
   * Extracts error-related attributes.
   */
  extractErrorAttributes(error, errorCategory, message) {
    const attributes = {
      'error.type': errorCategory,
    };

    if (error instanceof Error) {
      attributes['error.name'] = error.name;

      // Only record error message if not sensitive data mode or if it's a safe error,
      // and then without the addresses a safe-looking message may still name.
      if (this.recordSensitiveData || this.isSafeErrorMessage(error.message)) {
        attributes['error.message'] = this.describeError(error.message, message);
      }
    }

    return attributes;
  }

  /**
   * Prepares error text for a span status or event: as it is when sensitive
   * data is recorded, otherwise without the addresses and phone numbers it
   * names, such as the recipient of an SMTP rejection, nor the recipient of
   * the message of a channel it is about, as the message names it.
   */
  describeError(text, message) {
    return this.recordSensitiveData ? text : redactMessageRecipient(text, message);
  }

  detectContentType(message) {
    // If there are attachments, it's always multipart
    if (message.attachments.length > 0) {
      return 'multipart';
    }

    // A calendar is a second body part wherever it goes: an alternative beside
    // the text and HTML on the transports that compose one, and a synthesized
    // invite.ics attachment on the rest.
    if (message.calendar != null) {
      return 'multipart';
    }

    // For content without attachments
    if ('html' in message.content) {
      return 'html';
    }
    return 'text';
  }

  extractDomain(email) {
    const atIndex = email.lastIndexOf('@');
    return atIndex > 0 ? email.substring(atIndex + 1) : 'unknown';
  }

  isSafeErrorMessage(message) {
    return SAFE_ERROR_MESSAGE.test(message);
  }
}

module.exports = { EmailAttributeExtractor };
