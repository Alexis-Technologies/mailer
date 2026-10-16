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
 */
class MetricsCollector {
  meter;
  config;

  // Counters
  attemptCounter;
  messageCounter;

  // Histograms
  durationHistogram;
  messageSizeHistogram;
  attachmentCountHistogram;

  // Gauges (using UpDownCounter)
  activeSendsGauge;

  constructor(meterProvider, config) {
    this.config = config;
    this.meter = meterProvider.getMeter(metadata.name, metadata.version);

    // Initialize counters
    this.attemptCounter = this.meter.createCounter(`${config.prefix}_email_attempts_total`, {
      description: 'Total number of email send attempts',
      unit: '1',
    });

    this.messageCounter = this.meter.createCounter(`${config.prefix}_email_messages_total`, {
      description: 'Messages a transport returned a receipt for, by priority and status',
      unit: '1',
    });

    // Initialize histograms
    this.durationHistogram = this.meter.createHistogram(`${config.prefix}_email_duration_seconds`, {
      description: 'Duration of email send operations',
      unit: 's',
      advice: { explicitBucketBoundaries: [...config.durationBuckets] },
    });

    this.messageSizeHistogram = this.meter.createHistogram(
      `${config.prefix}_email_message_size_bytes`,
      {
        description: 'Size of email messages in bytes',
        unit: 'By',
      },
    );

    this.attachmentCountHistogram = this.meter.createHistogram(
      `${config.prefix}_email_attachments_count`,
      {
        description: 'Number of attachments per email',
        unit: '1',
      },
    );

    // Initialize gauge
    this.activeSendsGauge = this.meter.createUpDownCounter(`${config.prefix}_email_active_sends`, {
      description: 'Number of currently active email send operations',
      unit: '1',
    });
  }

  /**
   * Records the start of an email send operation.
   */
  recordSendStart(transport) {
    this.activeSendsGauge.add(1, { transport });
  }

  /**
   * Records the receipt of one message, once, with the priority of the
   * message and whether it was sent.
   */
  recordMessageOutcome(transport, priority, successful) {
    this.messageCounter.add(1, {
      transport,
      priority,
      status: successful ? 'success' : 'failure',
    });
  }

  /**
   * Records the end of an email send operation, however it ended.
   */
  recordSendEnd(transport) {
    this.activeSendsGauge.add(-1, { transport });
  }

  /**
   * Records the completion of an email send operation.
   */
  recordSendComplete(transport, duration, success, errorType) {
    const labels = {
      transport,
      status: success ? 'success' : 'failure',
      ...(errorType && { error_type: errorType }),
    };

    this.attemptCounter.add(1, labels);
    this.durationHistogram.record(duration, labels);
  }

  /**
   * Records metrics for individual messages.
   */
  recordMessage(message, transport, messageSize = estimateMessageSize(message)) {
    const labels = {
      transport,
      priority: message.priority,
      content_type: this.getContentType(message),
    };

    this.messageSizeHistogram.record(messageSize, labels);
    this.attachmentCountHistogram.record(message.attachments.length, labels);
  }

  /**
   * Records metrics for batch operations.
   */
  recordBatch(transport, duration, successCount, failureCount) {
    const labels = { transport };

    // Record batch-level metrics
    this.attemptCounter.add(1, {
      ...labels,
      status: batchStatus(successCount, failureCount),
      operation: 'batch',
    });

    this.durationHistogram.record(duration, {
      ...labels,
      operation: 'batch',
    });
  }

  /**
   * Records an error for metrics classification.
   */
  recordError(transport, errorType, operation = 'send') {
    this.attemptCounter.add(1, {
      transport,
      status: 'failure',
      error_type: errorType,
      operation,
    });
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
