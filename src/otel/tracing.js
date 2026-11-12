// Ported from upyo v0.7.0 (packages/opentelemetry/src/tracing.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

// SpanKind.CLIENT and SpanStatusCode.OK and ERROR of the OpenTelemetry API:
// the providers are passed in, and @opentelemetry/api is never required.
const SPAN_KIND_CLIENT = 2;
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;
const { messageOf } = require('../internal/decorator.js');
const { EmailAttributeExtractor } = require('./attributes.js');
const metadata = require('../version.js');

// The stack of an error for the `exception.stacktrace` of the semantic
// conventions, with its message described as the status and the events
// describe it.  Only the message is redacted where the stack repeats it: the
// frames hold no address, and paths such as node_modules/@scope/... would read
// as one; a stack that does not repeat its message is redacted whole.
const describeStack = (error, extractor, sent) => {
  const stack = error.stack;
  if (typeof stack !== 'string' || stack === '') return undefined;
  const at = error.message === '' ? -1 : stack.indexOf(error.message);
  if (at === -1) return extractor.describeError(stack, sent);
  const message = extractor.describeError(error.message, sent);
  return stack.slice(0, at) + message + stack.slice(at + error.message.length);
};

/**
 * Manages OpenTelemetry tracing for the sends of messages, of email and of
 * the channels.  A span is named by `spanPrefix`, or by the channel of its
 * message: `email send`, `sms send`.
 */
class TracingCollector {
  tracer;
  config;
  attributeExtractor;

  constructor(tracerProvider, config, transportName, transportVersion, random) {
    this.config = config;
    this.random = random;
    this.tracer = tracerProvider.getTracer(metadata.name, metadata.version);
    this.attributeExtractor = new EmailAttributeExtractor(
      transportName,
      config.recordSensitiveData,
      transportVersion,
    );
  }

  /**
   * Creates a span for a single email send operation.
   */
  createSendSpan(message, networkAttributes, messageSize) {
    if (!this.shouldSample()) {
      return new NoOpEmailSpan();
    }

    const spanName = `${this.config.spanPrefix ?? message.channel ?? 'email'} send`;
    const span = this.tracer.startSpan(spanName, {
      kind: SPAN_KIND_CLIENT,
    });

    // Set message attributes
    const messageAttributes = this.attributeExtractor.extractMessageAttributes(
      message,
      messageSize,
    );
    span.setAttributes(messageAttributes);

    // Set network attributes if provided
    if (networkAttributes) {
      span.setAttributes(networkAttributes);
    }

    return new LiveEmailSpan(span, this.attributeExtractor, message);
  }

  /**
   * Creates a span for the send of serialized MIME, whose envelope is all
   * that is known of it.
   */
  createRawSendSpan(message, networkAttributes, messageSize) {
    if (!this.shouldSample()) {
      return new NoOpEmailSpan();
    }
    const span = this.tracer.startSpan(`${this.config.spanPrefix ?? 'email'} send_raw`, {
      kind: SPAN_KIND_CLIENT,
    });
    span.setAttributes(this.attributeExtractor.extractRawMessageAttributes(message, messageSize));
    if (networkAttributes) {
      span.setAttributes(networkAttributes);
    }
    return new LiveEmailSpan(span, this.attributeExtractor);
  }

  /**
   * Creates a span for a batch send operation.  Its batch attributes come at
   * its end (`recordBatchTotals`), once the batch has been read, and so does
   * its name, by the channel of its messages, without `spanPrefix`:
   * `email send_batch` until then, `sms send_batch` for a batch of SMS,
   * `message send_batch` for one of several channels.
   */
  createBatchSpan(networkAttributes) {
    if (!this.shouldSample()) {
      return new NoOpEmailSpan();
    }

    const spanName = `${this.config.spanPrefix ?? 'email'} send_batch`;
    const span = this.tracer.startSpan(spanName, {
      kind: SPAN_KIND_CLIENT,
    });

    // Set network attributes if provided
    if (networkAttributes) {
      span.setAttributes(networkAttributes);
    }

    const live = new LiveEmailSpan(span, this.attributeExtractor);
    live.renamesBatch = this.config.spanPrefix === undefined;
    return live;
  }

  shouldSample() {
    return (this.random ?? Math.random)() < this.config.samplingRate;
  }
}

/**
 * Live implementation of EmailSpan that delegates to OpenTelemetry Span.
 * The events of a span of email are `email.sent` and `email.send_failed`,
 * those of a span of a channel or of several `message.sent` and
 * `message.send_failed`.
 */
class LiveEmailSpan {
  span;
  attributeExtractor;
  retryCount = 0;
  /** The message of a send, whose recipient the error texts are redacted of. */
  message;
  /** The channel of the span, `null` for a batch of several. */
  channel;
  /** Whether a batch span is named by the channel of its messages. */
  renamesBatch = false;

  constructor(span, attributeExtractor, message) {
    this.span = span;
    this.attributeExtractor = attributeExtractor;
    this.message = message;
    this.channel = message === undefined ? 'email' : (message.channel ?? 'email');
  }

  get isEmail() {
    return this.channel === 'email';
  }

  /**
   * Names a batch by the channel of its messages, `null` for several, once
   * they are read; a batch of email, or of none, keeps its name.
   */
  setBatchChannel(channel) {
    if (channel === undefined || channel === 'email' || this.channel === channel) return;
    this.channel = channel;
    if (this.renamesBatch) this.span.updateName(`${channel ?? 'message'} send_batch`);
  }

  addEvent(name, attributes) {
    this.span.addEvent(name, attributes);
  }

  setAttributes(attributes) {
    this.span.setAttributes(attributes);
  }

  recordError(error, errorCategory) {
    // Set span status to error
    const extractor = this.attributeExtractor;
    const sent = this.message;
    this.span.setStatus({
      code: SPAN_STATUS_ERROR,
      message:
        error instanceof Error ? extractor.describeError(error.message, sent) : 'Unknown error',
    });

    // Record error attributes
    const errorAttributes = extractor.extractErrorAttributes(error, errorCategory, sent);
    this.span.setAttributes(errorAttributes);

    // Add error event
    const stacktrace = error instanceof Error ? describeStack(error, extractor, sent) : undefined;
    this.span.addEvent('exception', {
      'exception.type': error instanceof Error ? error.constructor.name : 'unknown',
      'exception.message': extractor.describeError(messageOf(error), sent),
      ...(stacktrace && { 'exception.stacktrace': stacktrace }),
    });
  }

  /**
   * Records a retry of the wrapped transport, at any level: the count is of
   * every retry the operation heard, the attempt that of the level retrying.
   */
  recordRetry(attempt, reason) {
    this.retryCount++;
    this.span.setAttributes({
      'mailer.retry.count': this.retryCount,
    });

    this.span.addEvent('retry', {
      'retry.attempt': attempt,
      ...(reason && { 'retry.reason': reason }),
    });
  }

  recordSuccess(given) {
    this.span.setStatus({ code: SPAN_STATUS_OK });
    // The id of a message of a channel may name its recipient: a chat of
    // Telegram (`<chat>:<message>`), a space of Google Chat.
    const messageId =
      typeof given === 'string' && this.channel !== 'email'
        ? this.attributeExtractor.describeError(given, this.message)
        : given;

    if (messageId) {
      this.span.setAttributes({
        'mailer.message.id': messageId,
      });
    }

    this.span.addEvent(this.isEmail ? 'email.sent' : 'message.sent', {
      ...(messageId && { 'message.id': messageId }),
    });
  }

  /**
   * Records a failure from its error messages, or the first of them when
   * `errorCount` says how many there were in all.
   */
  recordFailure(errorMessages, errorCount = errorMessages.length) {
    const extractor = this.attributeExtractor;
    const described = [];
    for (const errorMessage of errorMessages) {
      described.push(extractor.describeError(errorMessage, this.message));
    }
    this.span.setStatus({
      code: SPAN_STATUS_ERROR,
      message: described[0] || 'Send failed',
    });

    this.span.setAttributes({
      [this.isEmail ? 'email.error.count' : 'mailer.error.count']: errorCount,
    });

    this.span.addEvent(this.isEmail ? 'email.send_failed' : 'message.send_failed', {
      'error.count': errorCount,
      'error.messages': JSON.stringify(described),
    });
  }

  recordBatchTotals(totals) {
    this.span.setAttributes(this.attributeExtractor.extractBatchAttributes(totals));
  }

  end() {
    this.span.end();
  }
}

/**
 * No-op implementation for when sampling is disabled.
 */
class NoOpEmailSpan {
  setBatchChannel() {}
  addEvent() {}
  setAttributes() {}
  recordError() {}
  recordRetry() {}
  recordSuccess() {}
  recordFailure() {}
  recordBatchTotals() {}
  end() {}
}

module.exports = { TracingCollector };
