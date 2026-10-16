// Ported from upyo v0.7.0 (packages/opentelemetry/src/tracing.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

// SpanKind.CLIENT and SpanStatusCode.OK and ERROR of the OpenTelemetry API:
// the providers are passed in, and @opentelemetry/api is never required.
const SPAN_KIND_CLIENT = 2;
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;
const { EmailAttributeExtractor } = require('./attributes.js');
const metadata = require('../version.js');

/**
 * Manages OpenTelemetry tracing for email operations.
 */
class TracingCollector {
  tracer;
  config;
  attributeExtractor;

  constructor(tracerProvider, config, transportName, transportVersion) {
    this.config = config;
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
  createSendSpan(message, networkAttributes) {
    if (!this.shouldSample()) {
      return new NoOpEmailSpan();
    }

    const spanName = `${this.config.spanPrefix} send`;
    const span = this.tracer.startSpan(spanName, {
      kind: SPAN_KIND_CLIENT,
    });

    // Set message attributes
    const messageAttributes = this.attributeExtractor.extractMessageAttributes(message);
    span.setAttributes(messageAttributes);

    // Set network attributes if provided
    if (networkAttributes) {
      span.setAttributes(networkAttributes);
    }

    return new LiveEmailSpan(span, this.attributeExtractor);
  }

  /**
   * Creates a span for a batch email send operation.  Its batch attributes
   * come at its end (`recordBatchTotals`), once the batch has been read.
   */
  createBatchSpan(networkAttributes) {
    if (!this.shouldSample()) {
      return new NoOpEmailSpan();
    }

    const spanName = `${this.config.spanPrefix} send_batch`;
    const span = this.tracer.startSpan(spanName, {
      kind: SPAN_KIND_CLIENT,
    });

    // Set network attributes if provided
    if (networkAttributes) {
      span.setAttributes(networkAttributes);
    }

    return new LiveEmailSpan(span, this.attributeExtractor);
  }

  shouldSample() {
    return Math.random() < this.config.samplingRate;
  }
}

/**
 * Live implementation of EmailSpan that delegates to OpenTelemetry Span.
 */
class LiveEmailSpan {
  span;
  attributeExtractor;

  constructor(span, attributeExtractor) {
    this.span = span;
    this.attributeExtractor = attributeExtractor;
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
    this.span.setStatus({
      code: SPAN_STATUS_ERROR,
      message: error instanceof Error ? extractor.describeError(error.message) : 'Unknown error',
    });

    // Record error attributes
    const errorAttributes = this.attributeExtractor.extractErrorAttributes(error, errorCategory);
    this.span.setAttributes(errorAttributes);

    // Add error event
    this.span.addEvent('exception', {
      'exception.type': error instanceof Error ? error.constructor.name : 'unknown',
      'exception.message': extractor.describeError(
        error instanceof Error ? error.message : String(error),
      ),
    });
  }

  // Dead upstream: nothing calls recordRetry (CLAUDE.md, known upstream bugs).
  /* c8 ignore start */
  recordRetry(attempt, reason) {
    this.span.setAttributes({
      'mailer.retry.count': attempt,
    });

    this.span.addEvent('retry', {
      'retry.attempt': attempt,
      ...(reason && { 'retry.reason': reason }),
    });
  }
  /* c8 ignore stop */

  recordSuccess(messageId) {
    this.span.setStatus({ code: SPAN_STATUS_OK });

    if (messageId) {
      this.span.setAttributes({
        'mailer.message.id': messageId,
      });
    }

    this.span.addEvent('email.sent', {
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
    for (const errorMessage of errorMessages) described.push(extractor.describeError(errorMessage));
    this.span.setStatus({
      code: SPAN_STATUS_ERROR,
      message: described[0] || 'Send failed',
    });

    this.span.setAttributes({
      'email.error.count': errorCount,
    });

    this.span.addEvent('email.send_failed', {
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
  addEvent() {}
  setAttributes() {}
  recordError() {}
  // Dead upstream: nothing calls recordRetry.
  /* c8 ignore start */
  recordRetry() {}
  /* c8 ignore stop */
  recordSuccess() {}
  recordFailure() {}
  recordBatchTotals() {}
  end() {}
}

module.exports = { TracingCollector };
