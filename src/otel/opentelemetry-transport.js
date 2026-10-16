// Ported from upyo v0.7.0 (packages/opentelemetry/src/opentelemetry-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createOpenTelemetryConfig, defaultErrorClassifier } = require('./config.js');
const { MetricsCollector } = require('./metrics.js');
const { TracingCollector } = require('./tracing.js');
const { estimateMessageSize } = require('./message-size.js');

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

    // Create span if tracing is enabled
    const span = this.tracingCollector?.createSendSpan(message, this.extractNetworkAttributes());

    // Record metrics start
    this.metricsCollector?.recordSendStart(this.transportName);
    this.metricsCollector?.recordMessage(message, this.transportName);

    try {
      // Apply custom attributes if configured
      if (this.config.attributeExtractor && span) {
        const customAttributes = this.config.attributeExtractor(
          'send',
          this.transportName,
          1,
          estimateMessageSize(message),
        );
        span.setAttributes(customAttributes);
      }

      // Delegate to wrapped transport
      const receipt = await this.wrappedTransport.send(message, options);
      const duration = (performance.now() - startTime) / 1000; // Convert to seconds
      this.metricsCollector?.recordMessageOutcome(
        this.transportName,
        message.priority,
        receipt.successful,
      );

      // Record success/failure
      if (receipt.successful) {
        span?.recordSuccess(receipt.messageId);
        this.metricsCollector?.recordSendComplete(this.transportName, duration, true);
      } else {
        const errorCategory = this.classifyReceipt(receipt);
        span?.recordFailure(receipt.errorMessages);
        this.metricsCollector?.recordSendComplete(
          this.transportName,
          duration,
          false,
          errorCategory,
        );
      }

      return receipt;
    } catch (error) {
      const duration = (performance.now() - startTime) / 1000;
      const errorCategory = this.classifyError(error);

      span?.recordError(error, errorCategory);
      this.metricsCollector?.recordSendComplete(this.transportName, duration, false, errorCategory);

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
    const messageArray = [];

    // Collect messages for batch metrics
    for await (const message of messages) {
      messageArray.push(message);
    }

    const batchSize = messageArray.length;

    // Create batch span if tracing is enabled
    const span = this.tracingCollector?.createBatchSpan(
      messageArray,
      batchSize,
      this.extractNetworkAttributes(),
    );

    // Record batch start
    this.metricsCollector?.recordSendStart(this.transportName);

    let successCount = 0;
    let failureCount = 0;
    const receipts = [];

    try {
      // Apply custom attributes if configured
      if (this.config.attributeExtractor && span) {
        const totalSize = messageArray.reduce((sum, msg) => sum + estimateMessageSize(msg), 0);
        const customAttributes = this.config.attributeExtractor(
          'send_batch',
          this.transportName,
          batchSize,
          totalSize,
        );
        span.setAttributes(customAttributes);
      }

      // Delegate to wrapped transport
      for await (const receipt of this.wrappedTransport.sendMany(messageArray, options)) {
        // A receipt answers the message at its position in the batch.
        this.metricsCollector?.recordMessageOutcome(
          this.transportName,
          messageArray[receipts.length]?.priority ?? 'unknown',
          receipt.successful,
        );
        receipts.push(receipt);

        if (receipt.successful) {
          successCount++;
        } else {
          failureCount++;
        }

        yield receipt;
      }

      const duration = (performance.now() - startTime) / 1000;

      // Record batch completion
      this.metricsCollector?.recordBatch(
        messageArray,
        this.transportName,
        duration,
        successCount,
        failureCount,
      );

      // Update span based on results
      if (failureCount === 0) {
        span?.recordSuccess();
      } else if (successCount > 0) {
        span?.addEvent('partial_success', {
          success_count: successCount,
          failure_count: failureCount,
        });
      } else {
        const allErrorMessages = receipts
          .filter((r) => !r.successful)
          .flatMap((r) => r.errorMessages);
        span?.recordFailure(allErrorMessages);
      }
    } catch (error) {
      // oxlint-disable-next-line no-underscore-dangle, no-unused-vars -- upstream
      const _duration = (performance.now() - startTime) / 1000;
      const errorCategory = this.classifyError(error);

      span?.recordError(error, errorCategory);
      this.metricsCollector?.recordError(this.transportName, errorCategory, 'send_batch');

      throw error;
    } finally {
      // Also when the caller stops reading the receipts early.
      this.metricsCollector?.recordSendEnd(this.transportName);
      span?.end();
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
            return {
              'network.protocol.name': parsedUrl.protocol.replace(':', ''),
              'server.address': parsedUrl.hostname,
              ...(parsedUrl.port && { 'server.port': parseInt(parsedUrl.port) }),
            };
          } catch {
            // Invalid URL, skip network attributes
          }
        }
      }
    }

    return undefined;
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

module.exports = { OpenTelemetryTransport };
