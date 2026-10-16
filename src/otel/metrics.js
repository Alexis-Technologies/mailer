// Ported from upyo v0.7.0 (packages/opentelemetry/src/metrics.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const metadata = require('../version.js');
const { estimateMessageSize } = require('./message-size.js');

// A batch with no failure succeeded, one with no success failed, and the rest
// failed in part.
const batchStatus = (successCount, failureCount) => {
  if (failureCount === 0) return 'success';
  return successCount === 0 ? 'failure' : 'partial_failure';
};

/**
 * Manages OpenTelemetry metrics collection for email operations.
 *
 * The instruments are named after the OpenTelemetry semantic conventions:
 * dotted names under the prefix, units in `unit` rather than in the name,
 * and namespaced attributes (`mailer.transport.name`, `mailer.operation.name`,
 * `mailer.status`, `email.priority`, `email.content.type`, `error.type`).
 */
class MetricsCollector {
  meter;
  config;

  // Counters
  attemptCounter;
  messageCounter;
  retryCounter;

  // Histograms
  durationHistogram;
  messageSizeHistogram;
  attachmentCountHistogram;

  // Gauges (using UpDownCounter)
  activeSendsGauge;

  constructor(meterProvider, config) {
    this.config = config;
    this.meter = meterProvider.getMeter(metadata.name, metadata.version);
    const prefix = `${config.prefix}.email`;

    // Initialize counters
    this.attemptCounter = this.meter.createCounter(`${prefix}.attempts`, {
      description: 'Send operations, of one message or a batch, by outcome',
      unit: '{attempt}',
    });

    this.messageCounter = this.meter.createCounter(`${prefix}.messages`, {
      description: 'Messages a transport returned a receipt for, by priority and status',
      unit: '{message}',
    });

    this.retryCounter = this.meter.createCounter(`${prefix}.retries`, {
      description: 'Requests the wrapped transport sent again after a failure',
      unit: '{retry}',
    });

    // Initialize histograms
    this.durationHistogram = this.meter.createHistogram(`${prefix}.duration`, {
      description: 'Duration of email send operations',
      unit: 's',
      advice: { explicitBucketBoundaries: [...config.durationBuckets] },
    });

    this.messageSizeHistogram = this.meter.createHistogram(`${prefix}.message.size`, {
      description: 'Estimated size of email messages',
      unit: 'By',
    });

    this.attachmentCountHistogram = this.meter.createHistogram(`${prefix}.attachments`, {
      description: 'Number of attachments per email',
      unit: '{attachment}',
    });

    // Initialize gauge
    this.activeSendsGauge = this.meter.createUpDownCounter(`${prefix}.active_sends`, {
      description: 'Email send operations in progress',
      unit: '{send}',
    });
  }

  /**
   * Records the start of an email send operation.
   */
  recordSendStart(transport) {
    this.activeSendsGauge.add(1, { 'mailer.transport.name': transport });
  }

  /**
   * Records the end of an email send operation, however it ended.
   */
  recordSendEnd(transport) {
    this.activeSendsGauge.add(-1, { 'mailer.transport.name': transport });
  }

  /**
   * Records the receipt of one message, once, with the priority of the
   * message and whether it was sent.
   */
  recordMessageOutcome(transport, priority, successful) {
    this.messageCounter.add(1, {
      'mailer.transport.name': transport,
      'email.priority': priority,
      'mailer.status': successful ? 'success' : 'failure',
    });
  }

  /**
   * Records a finished send operation: `send` or `send_batch`, its duration
   * in seconds, its status (`success`, `failure` or, for a batch,
   * `partial_failure`) and the category of its failure, if any.
   */
  recordAttempt(transport, operation, duration, status, errorType) {
    const attributes = {
      'mailer.transport.name': transport,
      'mailer.operation.name': operation,
      'mailer.status': status,
      ...(errorType && { 'error.type': errorType }),
    };

    this.attemptCounter.add(1, attributes);
    this.durationHistogram.record(duration, attributes);
  }

  /**
   * Records a finished batch from the counts of its receipts.
   */
  recordBatch(transport, duration, successCount, failureCount) {
    this.recordAttempt(transport, 'send_batch', duration, batchStatus(successCount, failureCount));
  }

  /**
   * Records metrics for individual messages.
   */
  recordMessage(message, transport, messageSize = estimateMessageSize(message)) {
    const attributes = {
      'mailer.transport.name': transport,
      'email.priority': message.priority,
      'email.content.type': this.getContentType(message),
    };

    this.messageSizeHistogram.record(messageSize, attributes);
    this.attachmentCountHistogram.record(message.attachments.length, attributes);
  }

  /**
   * Records a retry of the wrapped transport, with the category of the
   * failure it retries.
   */
  recordRetry(transport, errorType) {
    this.retryCounter.add(1, { 'mailer.transport.name': transport, 'error.type': errorType });
  }

  getContentType(message) {
    // A calendar is a second body part wherever it goes: an alternative beside
    // the text and HTML on the transports that compose one, and a synthesized
    // invite.ics attachment on the rest.
    if (message.calendar != null) {
      return 'multipart';
    }
    if ('html' in message.content) {
      return message.content.text ? 'multipart' : 'html';
    }
    return 'text';
  }
}

module.exports = { MetricsCollector };
