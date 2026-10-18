// Ported from upyo v0.7.0 (packages/opentelemetry/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { OpenTelemetryTransport } = require('./opentelemetry-transport.js');
const { instrumentHandler } = require('./handler.js');
const { defaultErrorClassifier } = require('./config.js');

/**
 * Creates an OpenTelemetry transport for email operations with comprehensive
 * observability features.
 *
 * This function wraps an existing email transport with OpenTelemetry tracing
 * and metrics collection, providing automatic instrumentation for email sending
 * operations. It supports both single message and batch operations with
 * configurable sampling, error classification, and attribute extraction.
 * The `tracerProvider` and `meterProvider` are passed in, from the
 * application's OpenTelemetry setup: this package does not require
 * `@opentelemetry/api`, so there is no fallback to its global providers.
 * Exporters and resource attributes, such as the service name, belong to that
 * setup too, so the `auto`, `serviceName` and `serviceVersion` options of
 * upstream are refused.
 *
 * @param baseTransport The underlying email transport to wrap with
 *                      OpenTelemetry instrumentation.
 * @param config Configuration options for OpenTelemetry setup including
 *               providers, sampling rates, and custom extractors.
 * @param config.tracerProvider The TracerProvider of the application, required
 *                              while tracing is enabled.
 * @param config.meterProvider The MeterProvider of the application, required
 *                             while metrics are enabled.
 * @param config.tracing Tracing configuration including sampling rates and
 *                       span settings.
 * @param config.metrics Metrics configuration including histogram boundaries
 *                       and collection settings.
 * @param config.attributeExtractor Custom function for extracting attributes
 *                                  from operations.
 * @param config.errorClassifier Custom function for categorizing errors into
 *                               types.
 * @returns An OpenTelemetry-enabled transport that instruments all email
 *          operations with traces and metrics.
 * @throws {TypeError} When `auto`, `serviceName`, `serviceVersion` or
 *                     `metrics.samplingRate` is set.
 *
 * @example
 * ```typescript
 * import { createOpenTelemetryTransport } from "@alexify/mailer/otel";
 * import { trace, metrics } from "@opentelemetry/api";
 *
 * const transport = createOpenTelemetryTransport(baseTransport, {
 *   tracerProvider: trace.getTracerProvider(),
 *   meterProvider: metrics.getMeterProvider(),
 *   tracing: {
 *     enabled: true,
 *     samplingRate: 0.1,
 *     recordSensitiveData: false,
 *   },
 *   metrics: {
 *     enabled: true,
 *     durationBuckets: [0.1, 0.5, 1, 5, 10],
 *   },
 * });
 * ```
 */
const createOpenTelemetryTransport = (baseTransport, config = {}) => {
  return new OpenTelemetryTransport(baseTransport, config);
};

/**
 * Creates a custom email attribute extractor function for OpenTelemetry
 * spans and metrics.
 *
 * This function creates a reusable attribute extractor that can be used to
 * generate consistent attributes for OpenTelemetry traces and metrics across
 * different email operations.  It supports both basic transport information
 * and custom attribute generation based on operation context.
 *
 * @param transportName The name of the email transport
 *                      (e.g., `"smtp"`, `"mailgun"`, `"sendgrid"`).
 * @param options Configuration options for customizing attribute extraction
 *                behavior.
 * @param options.recordSensitiveData Whether to include sensitive data like
 *                                    email addresses in attributes.
 *                                    Defaults to false for security.
 * @param options.transportVersion The version of the transport implementation
 *                                 for better observability.
 * @param options.customAttributes A function to generate custom attributes
 *                                 based on operation context.
 * @returns A function that extracts attributes from email operations,
 *          suitable for use with OpenTelemetry spans and metrics.
 *
 * @example Basic usage
 * ```typescript
 * import { createEmailAttributeExtractor } from "@alexify/mailer/otel";
 *
 * const extractor = createEmailAttributeExtractor("smtp", {
 *   transportVersion: "2.1.0",
 * });
 *
 * const transport = createOpenTelemetryTransport(baseTransport, {
 *   attributeExtractor: extractor,
 * });
 * ```
 *
 * @example With custom attributes
 * ```typescript
 * import { createEmailAttributeExtractor } from "@alexify/mailer/otel";
 *
 * const extractor = createEmailAttributeExtractor("smtp", {
 *   recordSensitiveData: false,
 *   transportVersion: "2.1.0",
 *   customAttributes: (operation, transportName, messageCount, totalSize) => ({
 *     "service.environment": process.env.NODE_ENV || "development",
 *     "email.batch.size": messageCount || 1,
 *     "email.total.bytes": totalSize || 0,
 *     "transport.type": transportName,
 *   }),
 * });
 *
 * const transport = createOpenTelemetryTransport(baseTransport, {
 *   attributeExtractor: extractor,
 * });
 * ```
 */
const createEmailAttributeExtractor = (_transportName, options = {}) => {
  return (operation, transport, messageCount, totalSize) => {
    // Use the EmailAttributeExtractor for base attributes
    const baseAttributes = {
      'operation.name': operation === 'send' ? 'email.send' : 'email.send_batch',
      'operation.type': 'email',
      'mailer.transport.name': transport,
    };

    // Add transport version if available
    if (options.transportVersion) {
      baseAttributes['mailer.transport.version'] = options.transportVersion;
    }

    // Add batch-specific attributes for batch operations
    if (operation === 'send_batch') {
      baseAttributes['mailer.batch.size'] = messageCount;
      if (totalSize !== undefined) {
        baseAttributes['email.batch.total_size'] = totalSize;
      }
    }

    const customAttributes =
      options.customAttributes?.(operation, transport, messageCount, totalSize) || {};

    return {
      ...baseAttributes,
      ...customAttributes,
    };
  };
};

/**
 * Creates a custom error classifier function for categorizing email sending
 * errors.
 *
 * This function creates an error classifier that categorizes errors into
 * meaningful groups for better observability and alerting.  It supports custom
 * regex patterns for domain-specific error classification while falling back
 * to the default classifier for common error types.  The classifier is used to
 * tag metrics and traces with error categories, enabling better
 * monitoring and debugging of email delivery issues.
 *
 * @param options Configuration options for error classification behavior.
 * @param options.patterns A record of category names mapped to regex patterns
 *                         for custom error classification.
 * @param options.fallback The fallback category to use when no patterns match
 *                         and the default classifier returns "unknown".
 *                         Defaults to "unknown".
 * @returns A function that classifies errors into string categories for use
 *          in OpenTelemetry attributes and metrics.
 *
 * @example Basic usage with common patterns
 * ```typescript
 * import { createErrorClassifier } from "@alexify/mailer/otel";
 *
 * const classifier = createErrorClassifier({
 *   patterns: {
 *     spam: /blocked.*spam|spam.*detected/i,
 *     bounce: /bounce|undeliverable|invalid.*recipient/i,
 *   },
 *   fallback: "email_error",
 * });
 *
 * const transport = createOpenTelemetryTransport(baseTransport, {
 *   errorClassifier: classifier,
 * });
 * ```
 *
 * @example Advanced patterns for specific email providers
 * ```typescript
 * import { createErrorClassifier } from "@alexify/mailer/otel";
 *
 * const classifier = createErrorClassifier({
 *   patterns: {
 *     spam: /blocked.*spam|spam.*detected|reputation/i,
 *     bounce: /bounce|undeliverable|invalid.*recipient/i,
 *     quota: /quota.*exceeded|mailbox.*full/i,
 *     reputation: /reputation|blacklist|blocked.*ip/i,
 *     temporary: /temporary.*failure|try.*again.*later/i,
 *     authentication: /authentication.*failed|invalid.*credentials/i,
 *   },
 *   fallback: "email_error",
 * });
 *
 * // The classifier will categorize errors like:
 * // new Error("Message blocked as spam") -> "spam"
 * // new Error("Mailbox quota exceeded") -> "quota"
 * // new Error("Authentication failed") -> "auth" (from default classifier)
 * // new Error("Unknown error") -> "email_error" (fallback)
 * ```
 */
const createErrorClassifier = (options = {}) => {
  const { patterns = {}, fallback = 'unknown' } = options;

  return (error) => {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Check custom patterns first
      for (const [category, pattern] of Object.entries(patterns)) {
        if (pattern.test(message)) {
          return category;
        }
      }
    }

    // Fall back to default classifier
    const defaultCategory = defaultErrorClassifier(error);
    return defaultCategory === 'unknown' ? fallback : defaultCategory;
  };
};

module.exports = {
  instrumentHandler,
  OpenTelemetryTransport,
  defaultErrorClassifier,
  createOpenTelemetryTransport,
  createEmailAttributeExtractor,
  createErrorClassifier,
};
