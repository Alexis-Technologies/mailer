// Ported from upyo v0.7.0 (packages/opentelemetry/src/metrics.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const metadata = require('../version.js');
const { estimateMessageSize } = require('./message-size.js');

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
      description: 'Total number of email messages processed',
      unit: '1',
    });

    // Initialize histograms
    this.durationHistogram = this.meter.createHistogram(`${config.prefix}_email_duration_seconds`, {
      description: 'Duration of email send operations',
      unit: 's',
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
  recordSendStart(transport, messageCount = 1) {
    if (!this.shouldSample()) {
      return;
    }

    const labels = {
      transport,
    };

    this.activeSendsGauge.add(1, labels);
    this.messageCounter.add(messageCount, {
      ...labels,
      priority: 'normal', // Default, will be overridden by recordMessage if available
    });
  }

  /**
   * Records the completion of an email send operation.
   */
  recordSendComplete(transport, duration, success, errorType) {
    if (!this.shouldSample()) {
      return;
    }

    const labels = {
      transport,
      status: success ? 'success' : 'failure',
      ...(errorType && { error_type: errorType }),
    };

    this.activeSendsGauge.add(-1, { transport });
    this.attemptCounter.add(1, labels);
    this.durationHistogram.record(duration, labels);
  }

  /**
   * Records metrics for individual messages.
   */
  recordMessage(message, transport) {
    if (!this.shouldSample()) {
      return;
    }

    const labels = {
      transport,
      priority: message.priority,
      content_type: this.getContentType(message),
    };

    const messageSize = estimateMessageSize(message);
    this.messageSizeHistogram.record(messageSize, labels);
    this.attachmentCountHistogram.record(message.attachments.length, labels);
  }

  /**
   * Records metrics for batch operations.
   */
  recordBatch(messages, transport, duration, successCount, failureCount) {
    if (!this.shouldSample()) {
      return;
    }

    // oxlint-disable-next-line no-underscore-dangle, no-unused-vars -- upstream
    const _totalMessages = messages.length;
    const labels = { transport };

    // Record batch-level metrics
    this.attemptCounter.add(1, {
      ...labels,
      status: failureCount === 0 ? 'success' : 'partial_failure',
      operation: 'batch',
    });

    this.durationHistogram.record(duration, {
      ...labels,
      operation: 'batch',
    });

    // Record individual message metrics
    for (const message of messages) {
      this.recordMessage(message, transport);
    }

    // Record success/failure breakdown
    if (successCount > 0) {
      this.messageCounter.add(successCount, {
        ...labels,
        status: 'success',
      });
    }

    if (failureCount > 0) {
      this.messageCounter.add(failureCount, {
        ...labels,
        status: 'failure',
      });
    }
  }

  /**
   * Records an error for metrics classification.
   */
  recordError(transport, errorType, operation = 'send') {
    if (!this.shouldSample()) {
      return;
    }

    this.attemptCounter.add(1, {
      transport,
      status: 'failure',
      error_type: errorType,
      operation,
    });
  }

  shouldSample() {
    return Math.random() < this.config.samplingRate;
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
