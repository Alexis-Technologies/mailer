// Ported from upyo v0.7.0 (packages/opentelemetry/src/attributes.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { redactAddresses } = require('../internal/redact-addresses.js');
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
   * Extracts attributes for a single message send operation.
   */
  extractMessageAttributes(message) {
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
      'mailer.transport.name': this.transportName,
      'mailer.retry.count': 0, // Will be updated by transport if retries occur
      'mailer.batch.size': 1,
    };

    // Add transport version if available
    if (this.transportVersion) {
      attributes['mailer.transport.version'] = this.transportVersion;
    }

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
    attributes['email.message.size'] = estimateMessageSize(message);

    return attributes;
  }

  /**
   * Extracts attributes for batch send operations.
   */
  extractBatchAttributes(messages, batchSize) {
    const totalAttachments = messages.reduce((sum, msg) => sum + msg.attachments.length, 0);
    const totalSize = messages.reduce((sum, msg) => sum + estimateMessageSize(msg), 0);

    const attributes = {
      // General operation attributes
      'operation.name': 'email.send_batch',
      'operation.type': 'email',

      // Batch-specific attributes
      'email.batch.size': batchSize,
      'email.batch.total_recipients': messages.reduce(
        (sum, msg) =>
          sum + msg.recipients.length + msg.ccRecipients.length + msg.bccRecipients.length,
        0,
      ),
      'email.batch.total_attachments': totalAttachments,
      'email.batch.total_size': totalSize,

      // Upyo-specific attributes
      'mailer.transport.name': this.transportName,
      'mailer.batch.size': batchSize,
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
  extractErrorAttributes(error, errorCategory) {
    const attributes = {
      'error.type': errorCategory,
    };

    if (error instanceof Error) {
      attributes['error.name'] = error.name;

      // Only record error message if not sensitive data mode or if it's a safe error
      if (this.recordSensitiveData || this.isSafeErrorMessage(error.message)) {
        attributes['error.message'] = error.message;
      }
    }

    return attributes;
  }

  /**
   * Prepares error text for a span status or event: as it is when sensitive
   * data is recorded, otherwise without the addresses it names, such as the
   * recipient of an SMTP rejection.
   */
  describeError(text) {
    return this.recordSensitiveData ? text : redactAddresses(text);
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
    const safePatterns = [
      /^timeout/i,
      /^connection/i,
      /^network/i,
      /^dns/i,
      /^rate limit/i,
      /^quota exceeded/i,
      /^service unavailable/i,
      /^internal server error/i,
      /^bad gateway/i,
      /^gateway timeout/i,
    ];

    return safePatterns.some((pattern) => pattern.test(message));
  }
}

module.exports = { EmailAttributeExtractor };
