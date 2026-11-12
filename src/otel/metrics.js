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

// The states a receipt of a channel names: `accepted` by a provider that
// tells its delivery later, `sent` by one that tells none (a chat, a push).
const STATES = new Set(['accepted', 'sent']);

// The attributes of a transport and of the channel of its messages, which a
// batch of several channels (`null`), or one not read yet, goes without.
const transportAttributes = (transport, channel) =>
  channel == null
    ? { 'mailer.transport.name': transport }
    : { 'mailer.transport.name': transport, 'mailer.channel': channel };

/**
 * Manages OpenTelemetry metrics collection for the sends of messages, of
 * email and of the channels.
 *
 * The instruments are named after the OpenTelemetry semantic conventions:
 * dotted names under the prefix (`mailer.message.*`; `mailer.email.*` in 1.x),
 * units in `unit` rather than in the name, and namespaced attributes
 * (`mailer.transport.name`, `mailer.channel`, `mailer.operation.name`,
 * `mailer.status`, `mailer.priority`, `email.content.type`, `error.type`).
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
  segmentCountHistogram;

  // Gauges (using UpDownCounter)
  activeSendsGauge;

  constructor(meterProvider, config) {
    this.config = config;
    this.meter = meterProvider.getMeter(metadata.name, metadata.version);
    const prefix = `${config.prefix}.message`;

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
      description: 'Duration of send operations',
      unit: 's',
      advice: { explicitBucketBoundaries: [...config.durationBuckets] },
    });

    this.messageSizeHistogram = this.meter.createHistogram(`${prefix}.size`, {
      description: 'Estimated size of messages',
      unit: 'By',
    });

    this.attachmentCountHistogram = this.meter.createHistogram(`${prefix}.attachments`, {
      description: 'Number of attachments of an email, or media of a message of a channel',
      unit: '{attachment}',
    });

    this.segmentCountHistogram = this.meter.createHistogram(`${prefix}.segments`, {
      description: 'Segments of an SMS, as the provider counted them in its receipt',
      unit: '{segment}',
    });

    // Initialize gauge
    this.activeSendsGauge = this.meter.createUpDownCounter(`${prefix}.active_sends`, {
      description: 'Send operations in progress',
      unit: '{send}',
    });
  }

  /**
   * Records the start of a send operation, with the channel of its message
   * (none for a batch, whose messages are read later).
   */
  recordSendStart(transport, channel) {
    this.activeSendsGauge.add(1, transportAttributes(transport, channel));
  }

  /**
   * Records the end of a send operation, however it ended, with the
   * attributes of its start.
   */
  recordSendEnd(transport, channel) {
    this.activeSendsGauge.add(-1, transportAttributes(transport, channel));
  }

  /**
   * Records the receipt of one message, once, with the channel and the
   * priority of the message, whether it was sent, and, for a failure, the
   * category and the code of its first error (`error.type`,
   * `mailer.error.code`, such as `rate-limit` and `http.429`) and, when the
   * provider may have taken it, `mailer.delivery_unknown`: the messages to
   * reconcile; for a channel, the state the provider took it in
   * (`mailer.message.state`, `accepted` or `sent`).  The segments a receipt
   * counts go to their histogram.
   */
  recordMessageOutcome(transport, channel, priority, receipt) {
    const first = receipt.successful ? undefined : receipt.errors?.[0];
    this.messageCounter.add(1, {
      ...transportAttributes(transport, channel),
      'mailer.priority': priority,
      'mailer.status': receipt.successful ? 'success' : 'failure',
      ...(typeof first?.category === 'string' && { 'error.type': first.category }),
      ...(typeof first?.code === 'string' && { 'mailer.error.code': first.code }),
      ...(receipt.deliveryUnknown === true && { 'mailer.delivery_unknown': true }),
      ...(STATES.has(receipt.state) && { 'mailer.message.state': receipt.state }),
    });
    if (typeof receipt.segments === 'number') {
      this.segmentCountHistogram.record(receipt.segments, transportAttributes(transport, channel));
    }
  }

  /**
   * Records a finished send operation: `send` or `send_batch`, its duration
   * in seconds, its status (`success`, `failure` or, for a batch,
   * `partial_failure`), the category of its failure, if any, and the channel
   * of its messages, when they have one.
   */
  recordAttempt(transport, operation, duration, status, errorType, channel) {
    const attributes = {
      ...transportAttributes(transport, channel),
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
  recordBatch(transport, duration, successCount, failureCount, channel) {
    this.recordAttempt(
      transport,
      'send_batch',
      duration,
      batchStatus(successCount, failureCount),
      undefined,
      channel,
    );
  }

  /**
   * Records metrics for individual messages.
   */
  recordMessage(message, transport, messageSize = estimateMessageSize(message)) {
    const channel = message.channel ?? 'email';
    const email = channel === 'email';
    const attributes = {
      ...transportAttributes(transport, channel),
      'mailer.priority': message.priority,
      ...(email && { 'email.content.type': this.getContentType(message) }),
    };

    this.messageSizeHistogram.record(messageSize, attributes);
    this.attachmentCountHistogram.record(
      email ? message.attachments.length : (message.media?.length ?? 0),
      attributes,
    );
  }

  /**
   * Records a retry of the wrapped transport, with the category of the
   * failure it retries, and the channel of its message (none in a batch).
   */
  recordRetry(transport, errorType, channel) {
    this.retryCounter.add(1, {
      ...transportAttributes(transport, channel),
      'error.type': errorType,
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
