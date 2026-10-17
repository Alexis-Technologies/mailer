// Ported from upyo v0.7.0 (packages/opentelemetry/src/opentelemetry-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createOpenTelemetryConfig, defaultErrorClassifier } = require('./config.js');
const { MetricsCollector } = require('./metrics.js');
const { TracingCollector } = require('./tracing.js');
const { estimateMessageSize } = require('./message-size.js');
const { isRawTransport, isVerifiableTransport } = require('../core/transport.js');
const { refuseRaw } = require('../internal/capabilities.js');

// How many error messages of a failed batch its span keeps; the count says how
// many there were in all.
const MAX_RECORDED_ERROR_MESSAGES = 10;

// Passes the messages of a batch on one at a time, telling `onMessage` of each.
const observeMessages = async function* (messages, onMessage) {
  for await (const message of messages) {
    onMessage(message);
    yield message;
  }
};

/**
 * OpenTelemetry decorator transport that adds observability to any existing transport.
 *
 * This transport wraps another transport implementation to provide automatic
 * OpenTelemetry metrics and tracing without requiring changes to existing code.
 * It follows the decorator pattern, accepting any transport and adding standardized
 * observability features including email delivery metrics, latency histograms,
 * error classification, and distributed tracing support.
 *
 * The transport also supports automatic resource cleanup by implementing
 * AsyncDisposable and properly disposing wrapped transports that support
 * either Disposable or AsyncDisposable interfaces.
 *
 * @example Basic usage with explicit providers
 * ```typescript
 * import { OpenTelemetryTransport } from "@alexify/mailer/otel";
 * import { createSmtpTransport } from "@alexify/mailer/smtp";
 * import { trace, metrics } from "@opentelemetry/api";
 *
 * const baseTransport = createSmtpTransport({
 *   host: "smtp.example.com",
 *   port: 587,
 * });
 *
 * const transport = new OpenTelemetryTransport(baseTransport, {
 *   tracerProvider: trace.getTracerProvider(),
 *   meterProvider: metrics.getMeterProvider(),
 *   tracing: {
 *     enabled: true,
 *     samplingRate: 1.0,
 *     recordSensitiveData: false,
 *   },
 *   metrics: {
 *     enabled: true,
 *   },
 * });
 *
 * // Use the transport normally - it will automatically create spans and metrics
 * await transport.send(message);
 * ```
 *
 * @example With custom error classification and attribute extraction
 * ```typescript
 * const transport = new OpenTelemetryTransport(baseTransport, {
 *   tracerProvider: trace.getTracerProvider(),
 *   meterProvider: metrics.getMeterProvider(),
 *   errorClassifier: (error) => {
 *     if (error.message.includes("spam")) return "spam";
 *     if (error.message.includes("bounce")) return "bounce";
 *     return "unknown";
 *   },
 *   attributeExtractor: (operation, transportName) => ({
 *     "service.environment": process.env.NODE_ENV,
 *     "transport.type": transportName,
 *   }),
 * });
 * ```
 */
class OpenTelemetryTransport {
  id;

  /**
   * The resolved OpenTelemetry configuration.
   */
  config;

  wrappedTransport;
  metricsCollector;
  tracingCollector;
  transportName;
  transportVersion;

  /**
   * Creates a new OpenTelemetry transport that wraps an existing transport.
   *
   * @param transport The base transport to wrap with observability.
   * @param config OpenTelemetry configuration options.
   */
  constructor(transport, config = {}) {
    this.wrappedTransport = transport;
    this.id = transport.id;
    this.config = createOpenTelemetryConfig(config);

    // Extract transport information
    this.transportName = this.extractTransportName(transport);
    this.transportVersion = this.extractTransportVersion(transport);

    // Initialize collectors based on configuration
    if (this.config.metrics.enabled && this.config.meterProvider) {
      this.metricsCollector = new MetricsCollector(this.config.meterProvider, this.config.metrics);
    }

    if (this.config.tracing.enabled && this.config.tracerProvider) {
      this.tracingCollector = new TracingCollector(
        this.config.tracerProvider,
        this.config.tracing,
        this.transportName,
        this.transportVersion,
        this.config.random,
      );
    }
  }

  /**
   * Sends a single email message with OpenTelemetry observability.
   *
   * @param message The email message to send.
   * @param options Optional transport options including abort signal.
   * @returns A promise that resolves to a receipt indicating success or failure.
   */
  async send(message, options) {
    const startTime = performance.now();
    // Estimated once, for the span, the metrics and the custom attributes.
    const messageSize = estimateMessageSize(message);

    // Create span if tracing is enabled
    const span = this.tracingCollector?.createSendSpan(
      message,
      this.extractNetworkAttributes(),
      messageSize,
    );

    // Record metrics start
    this.metricsCollector?.recordSendStart(this.transportName);
    this.metricsCollector?.recordMessage(message, this.transportName, messageSize);

    return this.observe(
      { startTime, span, messageSize, priority: message.priority },
      (sendOptions) => this.wrappedTransport.send(message, sendOptions),
      options,
    );
  }

  /**
   * Sends serialized MIME through the wrapped transport, in a span of its own
   * (`send_raw`) and in the metrics of a send.  A wrapped transport without
   * `sendRaw()` gives a failed receipt of the category `configuration`.
   *
   * @param message The serialized message and its envelope.
   * @param options Optional transport options including abort signal.
   * @returns The receipt of the wrapped transport.
   */
  async sendRaw(message, options) {
    if (!isRawTransport(this.wrappedTransport)) return refuseRaw(this.wrappedTransport);
    const startTime = performance.now();
    const messageSize = message?.content instanceof Uint8Array ? message.content.byteLength : 0;
    const span = this.tracingCollector?.createRawSendSpan(
      message,
      this.extractNetworkAttributes(),
      messageSize,
    );
    this.metricsCollector?.recordSendStart(this.transportName);
    return this.observe(
      { startTime, span, messageSize, priority: 'normal' },
      (sendOptions) => this.wrappedTransport.sendRaw(message, sendOptions),
      options,
    );
  }

  /**
   * Verifies the wrapped transport, which has nothing to check when it
   * cannot verify.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    if (isVerifiableTransport(this.wrappedTransport)) await this.wrappedTransport.verify(options);
  }

  /**
   * Runs one send in its span and metrics: the custom attributes, the
   * outcome, the error and the end.
   */
  async observe(context, deliver, options) {
    const { startTime, span, messageSize, priority } = context;
    try {
      // Apply custom attributes if configured
      if (this.config.attributeExtractor && span) {
        const customAttributes = this.config.attributeExtractor(
          'send',
          this.transportName,
          1,
          messageSize,
        );
        span.setAttributes(customAttributes);
      }

      // Delegate to wrapped transport
      const receipt = await deliver(this.withRetryRecording(options, span));
      const duration = (performance.now() - startTime) / 1000; // Convert to seconds
      this.metricsCollector?.recordMessageOutcome(this.transportName, priority, receipt.successful);

      // Record success/failure
      if (receipt.successful) {
        span?.recordSuccess(receipt.messageId);
        this.metricsCollector?.recordAttempt(this.transportName, 'send', duration, 'success');
      } else {
        const errorCategory = this.classifyReceipt(receipt);
        span?.recordFailure(receipt.errorMessages);
        this.metricsCollector?.recordAttempt(
          this.transportName,
          'send',
          duration,
          'failure',
          errorCategory,
        );
      }

      return receipt;
    } catch (error) {
      const duration = (performance.now() - startTime) / 1000;
      const errorCategory = this.classifyError(error);

      span?.recordError(error, errorCategory);
      this.metricsCollector?.recordAttempt(
        this.transportName,
        'send',
        duration,
        'failure',
        errorCategory,
      );

      throw error;
    } finally {
      this.metricsCollector?.recordSendEnd(this.transportName);
      span?.end();
    }
  }

  /**
   * Sends multiple email messages with OpenTelemetry observability.
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including abort signal.
   * @returns An async iterable that yields receipts for each sent message.
   */
  async *sendMany(messages, options) {
    const startTime = performance.now();
    const metrics = this.metricsCollector;
    const transportName = this.transportName;

    // Create batch span if tracing is enabled
    const span = this.tracingCollector?.createBatchSpan(this.extractNetworkAttributes());

    // Record batch start
    metrics?.recordSendStart(transportName);

    // The messages are observed as the wrapped transport reads them rather
    // than collected first, so a batch of any length takes bounded memory.
    // The priority of each waits in `pending` for the receipt that answers it.
    const totals = { count: 0, recipients: 0, attachments: 0, size: 0 };
    const pending = [];
    let head = 0;
    const observed = observeMessages(messages, (message) => {
      const size = estimateMessageSize(message);
      totals.count++;
      totals.recipients +=
        message.recipients.length + message.ccRecipients.length + message.bccRecipients.length;
      totals.attachments += message.attachments.length;
      totals.size += size;
      pending.push(message.priority);
      metrics?.recordMessage(message, transportName, size);
    });

    let successCount = 0;
    let failureCount = 0;
    // The first error messages of the failed receipts, and how many in all.
    const errorMessages = [];
    let errorMessageCount = 0;

    try {
      const sendOptions = this.withRetryRecording(options, span);
      for await (const receipt of this.wrappedTransport.sendMany(observed, sendOptions)) {
        // A receipt answers the oldest message still waiting for one.
        const priority = head < pending.length ? pending[head++] : 'unknown';
        if (head === pending.length) {
          pending.length = 0;
          head = 0;
        }
        metrics?.recordMessageOutcome(transportName, priority, receipt.successful);

        if (receipt.successful) {
          successCount++;
        } else {
          failureCount++;
          errorMessageCount = keepErrorMessages(errorMessages, errorMessageCount, receipt);
        }

        yield receipt;
      }

      const duration = (performance.now() - startTime) / 1000;

      // Record batch completion
      metrics?.recordBatch(transportName, duration, successCount, failureCount);

      // Update span based on results
      if (failureCount === 0) {
        span?.recordSuccess();
      } else if (successCount > 0) {
        span?.addEvent('partial_success', {
          success_count: successCount,
          failure_count: failureCount,
        });
      } else {
        span?.recordFailure(errorMessages, errorMessageCount);
      }
    } catch (error) {
      const duration = (performance.now() - startTime) / 1000;
      const errorCategory = this.classifyError(error);

      span?.recordError(error, errorCategory);
      metrics?.recordAttempt(transportName, 'send_batch', duration, 'failure', errorCategory);

      throw error;
    } finally {
      // Also when the caller stops reading the receipts early.
      metrics?.recordSendEnd(transportName);
      if (span) {
        span.recordBatchTotals(totals);
        // Apply custom attributes if configured
        if (this.config.attributeExtractor) {
          span.setAttributes(
            this.config.attributeExtractor('send_batch', transportName, totals.count, totals.size),
          );
        }
        span.end();
      }
    }
  }

  /**
   * Cleanup resources if the wrapped transport supports Disposable or AsyncDisposable.
   */
  async [Symbol.asyncDispose]() {
    if (!this.wrappedTransport) {
      return;
    }

    // Try AsyncDisposable first
    if (typeof this.wrappedTransport[Symbol.asyncDispose] === 'function') {
      await this.wrappedTransport[Symbol.asyncDispose]();
      return;
    }

    // Fall back to synchronous Disposable
    if (typeof this.wrappedTransport[Symbol.dispose] === 'function') {
      this.wrappedTransport[Symbol.dispose]();
    }
  }

  extractTransportName(transport) {
    if (typeof transport.id === 'string' && transport.id !== '') {
      return transport.id;
    }

    // Try to extract from constructor name
    const constructorName = transport.constructor?.name;
    if (constructorName && constructorName !== 'Object') {
      return constructorName.toLowerCase().replace('transport', '');
    }

    // Try to extract from config if available
    if ('config' in transport && transport.config && typeof transport.config === 'object') {
      // Check for common config properties that might indicate transport type
      if ('domain' in transport.config) return 'mailgun';
      if ('apiKey' in transport.config && 'region' in transport.config) {
        return 'sendgrid';
      }
      if ('accessKeyId' in transport.config) return 'ses';
      if ('host' in transport.config) return 'smtp';
    }

    return 'unknown';
  }

  extractTransportVersion(transport) {
    // Try to extract version from config or transport properties
    if ('config' in transport && transport.config && typeof transport.config === 'object') {
      if ('version' in transport.config) {
        return String(transport.config.version);
      }
    }
    return undefined;
  }

  extractNetworkAttributes() {
    const transport = this.wrappedTransport;

    if ('config' in transport && transport.config && typeof transport.config === 'object') {
      const config = transport.config;

      // SMTP transport
      if ('host' in config && 'port' in config) {
        return {
          'network.protocol.name': 'smtp',
          'server.address': String(config.host),
          'server.port': Number(config.port),
        };
      }

      // HTTP-based transports
      if ('baseUrl' in config || 'endpoint' in config || 'domain' in config) {
        const url =
          config.baseUrl ||
          config.endpoint ||
          (config.domain && `https://api.${config.region === 'eu' ? 'eu.' : ''}mailgun.net`);

        if (url && typeof url === 'string') {
          try {
            const parsedUrl = new URL(url);
            // The protocol is HTTP whether or not over TLS; the scheme says which.
            return {
              'network.protocol.name': 'http',
              'url.scheme': parsedUrl.protocol.slice(0, -1),
              'server.address': parsedUrl.hostname,
              ...(parsedUrl.port && { 'server.port': Number(parsedUrl.port) }),
            };
          } catch {
            // Invalid URL, skip network attributes
          }
        }
      }
    }

    return undefined;
  }

  /**
   * The options passed on to the wrapped transport: its retries are recorded
   * on the span and in the metrics, and still reach the caller's `onRetry`.
   */
  withRetryRecording(options, span) {
    const metrics = this.metricsCollector;
    if (span == null && metrics == null) return options;
    const onRetry = options?.onRetry;
    return {
      ...options,
      onRetry: (event) => {
        const errorType = this.classifyError(event.error);
        span?.recordRetry(event.attempt, errorType);
        metrics?.recordRetry(this.transportName, errorType);
        onRetry?.(event);
      },
    };
  }

  classifyError(error) {
    const classifier = this.config.errorClassifier || defaultErrorClassifier;
    return classifier(error);
  }

  classifyReceipt(receipt) {
    const structuredCategory = receipt.errors?.[0]?.category;
    if (structuredCategory != null) return structuredCategory;
    return this.classifyErrors(receipt.errorMessages);
  }

  classifyErrors(errorMessages) {
    // Use first error message to determine category
    if (errorMessages.length === 0) return 'unknown';

    // Create a synthetic error for classification
    const syntheticError = new Error(errorMessages[0]);
    return this.classifyError(syntheticError);
  }
}

// Keeps the messages of a failed receipt while fewer than the bound are kept,
// and counts all of them.
const keepErrorMessages = (kept, count, receipt) => {
  let total = count;
  for (const errorMessage of receipt.errorMessages) {
    if (total++ < MAX_RECORDED_ERROR_MESSAGES) kept.push(errorMessage);
  }
  return total;
};

module.exports = { OpenTelemetryTransport };
