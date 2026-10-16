// Types ported from upyo v0.7.0 (packages/opentelemetry/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/// <reference lib="esnext.disposable" />

import type { Message, Receipt, Transport, TransportOptions } from '../../index.js';

// The parts of the OpenTelemetry API this subpath calls, as structural types:
// the providers come from the application's own setup, and nothing here
// imports @opentelemetry/api. Its TracerProvider and MeterProvider fit them.

/** An attribute value of a span, an event or a metric. */
export type AttributeValue =
  | string
  | number
  | boolean
  | Array<null | undefined | string>
  | Array<null | undefined | number>
  | Array<null | undefined | boolean>;

/** Attributes of a span, an event or a metric. */
export type Attributes = Record<string, AttributeValue | undefined>;

/** A span, as `Tracer.startSpan()` of the OpenTelemetry API returns it. */
export interface Span {
  setAttributes(attributes: Attributes): unknown;
  addEvent(name: string, attributes?: Attributes): unknown;
  setStatus(status: { code: number; message?: string }): unknown;
  end(): void;
}

/** A tracer of the OpenTelemetry API. */
export interface Tracer {
  startSpan(name: string, options?: { kind?: number; attributes?: Attributes }): Span;
}

/** A tracer provider of the OpenTelemetry API, such as `trace.getTracerProvider()`. */
export interface TracerProvider {
  getTracer(name: string, version?: string): Tracer;
}

/** The options of a metric instrument. */
export interface MetricOptions {
  description?: string;
  unit?: string;
  /** Hints for the SDK, such as the bucket boundaries of a histogram. */
  advice?: { explicitBucketBoundaries?: number[] };
}

/** A counter, or an up-down counter, of the OpenTelemetry API. */
export interface Counter {
  add(value: number, attributes?: Attributes): void;
}

/** A histogram of the OpenTelemetry API. */
export interface Histogram {
  record(value: number, attributes?: Attributes): void;
}

/** A meter of the OpenTelemetry API. */
export interface Meter {
  createCounter(name: string, options?: MetricOptions): Counter;
  createHistogram(name: string, options?: MetricOptions): Histogram;
  createUpDownCounter(name: string, options?: MetricOptions): Counter;
}

/** A meter provider of the OpenTelemetry API, such as `metrics.getMeterProvider()`. */
export interface MeterProvider {
  getMeter(name: string, version?: string): Meter;
}

/**
 * Configuration options for OpenTelemetry observability features.
 */
export interface ObservabilityConfig {
  /**
   * Whether the feature is enabled.
   * @default true
   */
  readonly enabled?: boolean;
}
/**
 * Configuration options for metrics collection.  Metrics are recorded for
 * every operation: sampled counters would undercount, and a sampled count of
 * active sends would drift.
 */
export interface MetricsConfig extends ObservabilityConfig {
  /**
   * Custom prefix for metric names.
   * @default "mailer"
   */
  readonly prefix?: string;
  /**
   * Bucket boundaries of the duration histogram, in seconds, passed to the SDK
   * as the advice `explicitBucketBoundaries` (OpenTelemetry API 1.7 or later;
   * a View of the application takes precedence).
   * @default [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0]
   */
  readonly durationBuckets?: readonly number[];
}
/**
 * Configuration options for tracing.
 */
export interface TracingConfig extends ObservabilityConfig {
  /**
   * The share of operations that get a span (0.0 to 1.0).
   * @default 1.0 (sample all)
   */
  readonly samplingRate?: number;
  /**
   * Whether to record sensitive information in spans.
   * When false, email addresses and subjects are redacted.
   * @default false
   */
  readonly recordSensitiveData?: boolean;
  /**
   * Custom span name prefix.
   * @default "email"
   */
  readonly spanPrefix?: string;
}
/**
 * Custom attribute extractor function type.
 */
export type AttributeExtractor = (
  operation: 'send' | 'send_batch',
  transportName: string,
  messageCount: number,
  totalSize?: number,
) => Record<string, string | number | boolean>;
/**
 * Custom error classifier function type.
 */
export type ErrorClassifier = (error: unknown) => string;
/**
 * Configuration options for auto-setup scenarios.
 */
export interface AutoConfig {
  /**
   * Service name for OpenTelemetry resource attributes.
   * @default "email-service"
   */
  readonly serviceName?: string;
  /**
   * Service version for OpenTelemetry resource attributes.
   */
  readonly serviceVersion?: string;
  /**
   * Tracing endpoint configuration.
   */
  readonly tracing?: {
    readonly endpoint?: string;
    readonly headers?: Record<string, string>;
  };
  /**
   * Metrics endpoint configuration.
   */
  readonly metrics?: {
    readonly endpoint?: string;
    readonly headers?: Record<string, string>;
  };
}
/**
 * Configuration for the OpenTelemetry transport.
 */
export interface OpenTelemetryConfig {
  /**
   * OpenTelemetry tracer provider.
   * Required if tracing is enabled.
   */
  readonly tracerProvider?: TracerProvider;
  /**
   * OpenTelemetry meter provider.
   * Required if metrics are enabled.
   */
  readonly meterProvider?: MeterProvider;
  /**
   * Metrics collection configuration.
   * @default { enabled: true }
   */
  readonly metrics?: MetricsConfig;
  /**
   * Tracing configuration.
   * @default { enabled: true }
   */
  readonly tracing?: TracingConfig;
  /**
   * Custom attribute extractor function.
   * Called for each operation to add custom attributes.
   */
  readonly attributeExtractor?: AttributeExtractor;
  /**
   * Custom error classifier function.
   * Called to classify errors into categories for metrics.
   */
  readonly errorClassifier?: ErrorClassifier;
  /**
   * Auto-configuration options for simplified setup.
   * When provided, missing providers will be auto-configured.
   */
  readonly auto?: AutoConfig;
}
/**
 * Resolved configuration with all defaults applied.
 */
interface ResolvedOpenTelemetryConfig {
  readonly tracerProvider?: TracerProvider;
  readonly meterProvider?: MeterProvider;
  readonly metrics: Required<MetricsConfig>;
  readonly tracing: Required<TracingConfig>;
  readonly attributeExtractor?: AttributeExtractor;
  readonly errorClassifier?: ErrorClassifier;
}
/**
 * Creates a resolved OpenTelemetry configuration with defaults applied.
 *
 * @param config The input configuration options.
 * @returns A resolved configuration with all defaults applied.
 * @throws {Error} When tracing is enabled but no TracerProvider is provided.
 * @throws {Error} When metrics are enabled but no MeterProvider is provided.
 */

/**
 * Default error classifier that categorizes errors into standard types.
 *
 * @example
 * ```typescript
 * import { defaultErrorClassifier } from "@alexify/mailer/otel";
 *
 * console.log(defaultErrorClassifier(new Error("401 Unauthorized"))); // "auth"
 * console.log(defaultErrorClassifier(new Error("Rate limit exceeded"))); // "rate-limit"
 * console.log(defaultErrorClassifier(new Error("Connection timeout"))); // "network"
 * console.log(defaultErrorClassifier(new Error("Invalid email format"))); // "validation"
 * console.log(defaultErrorClassifier(new Error("500 Internal Server Error"))); // "server-error"
 * console.log(defaultErrorClassifier(new Error("Something else"))); // "unknown"
 * ```
 *
 * @param error The error to classify.
 * @returns A string category such as `"auth"`, `"rate-limit"`, `"network"`,
 *          `"validation"`, `"service-unavailable"`, `"server-error"`, or
 *          `"unknown"`.
 */
export declare function defaultErrorClassifier(error: unknown): string;

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
export declare class OpenTelemetryTransport<TProviderId extends string = string>
  implements Transport<TProviderId>, AsyncDisposable
{
  readonly id: TProviderId;
  /**
   * The resolved OpenTelemetry configuration.
   */
  readonly config: ResolvedOpenTelemetryConfig;
  /**
   * Creates a new OpenTelemetry transport that wraps an existing transport.
   *
   * @param transport The base transport to wrap with observability.
   * @param config OpenTelemetry configuration options.
   * @throws {Error} When an enabled feature has no provider.
   * @throws {TypeError} When `metrics.samplingRate` is set.
   */
  constructor(transport: Transport<TProviderId>, config?: OpenTelemetryConfig);
  /**
   * Sends a single email message with OpenTelemetry observability.
   *
   * @param message The email message to send.
   * @param options Optional transport options including abort signal.
   * @returns A promise that resolves to a receipt indicating success or failure.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends multiple email messages with OpenTelemetry observability.
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including abort signal.
   * @returns An async iterable that yields receipts for each sent message.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
  /**
   * Cleanup resources if the wrapped transport supports Disposable or AsyncDisposable.
   */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Configuration options for the createOpenTelemetryTransport factory function.
 *
 * This interface extends the base OpenTelemetryConfig with additional options
 * for service identification and auto-configuration. It provides a simplified
 * way to configure OpenTelemetry observability without manually setting up
 * providers and exporters.
 *
 * @example
 * ```typescript
 * const config: CreateOpenTelemetryTransportConfig = {
 *   serviceName: "email-service",
 *   serviceVersion: "1.2.0",
 *   tracing: {
 *     enabled: true,
 *     samplingRate: 0.1,
 *     recordSensitiveData: false,
 *   },
 *   metrics: {
 *     enabled: true,
 *     durationBuckets: [0.1, 0.5, 1, 5, 10],
 *   },
 *   auto: {
 *     tracing: {
 *       endpoint: "http://jaeger:14268/api/traces",
 *     },
 *     metrics: {
 *       endpoint: "http://prometheus:9090/api/v1/write",
 *     },
 *   },
 * };
 * ```
 */
export interface CreateOpenTelemetryTransportConfig extends Omit<OpenTelemetryConfig, 'auto'> {
  /**
   * Service name for OpenTelemetry resource attributes.
   * This identifies your service in distributed traces and metrics.
   * @default "email-service"
   */
  readonly serviceName?: string;
  /**
   * Service version for OpenTelemetry resource attributes.
   * Useful for tracking performance across different deployment versions.
   */
  readonly serviceVersion?: string;
  /**
   * Auto-configuration options for setting up OpenTelemetry exporters and processors.
   * When provided, the factory function will automatically configure the necessary
   * infrastructure for sending telemetry data to observability backends.
   */
  readonly auto?: AutoConfig;
}
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
 *
 * @param baseTransport The underlying email transport to wrap with
 *                      OpenTelemetry instrumentation.
 * @param config Configuration options for OpenTelemetry setup including
 *               providers, sampling rates, and custom extractors.
 * @param config.serviceName Service name for OpenTelemetry resource attributes.
 *                           Defaults to "email-service".
 * @param config.serviceVersion Service version for OpenTelemetry resource
 *                              attributes.
 * @param config.tracerProvider The TracerProvider of the application, required
 *                              while tracing is enabled.
 * @param config.meterProvider The MeterProvider of the application, required
 *                             while metrics are enabled.
 * @param config.auto Auto-configuration options for setting up exporters and
 *                    processors.
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
 *
 * @example With minimal configuration
 * ```typescript
 * import { createOpenTelemetryTransport } from "@alexify/mailer/otel";
 * import { createSmtpTransport } from "@alexify/mailer/smtp";
 *
 * const smtpTransport = createSmtpTransport({
 *   host: "smtp.example.com",
 *   port: 587,
 * });
 *
 * const transport = createOpenTelemetryTransport(smtpTransport, {
 *   serviceName: "email-service",
 *   serviceVersion: "1.0.0",
 * });
 * ```
 *
 * @example With explicit providers
 * ```typescript
 * import { createOpenTelemetryTransport } from "@alexify/mailer/otel";
 * import { trace, metrics } from "@opentelemetry/api";
 *
 * const transport = createOpenTelemetryTransport(baseTransport, {
 *   tracerProvider: trace.getTracerProvider(),
 *   meterProvider: metrics.getMeterProvider(),
 *   serviceName: "my-email-service",
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
 *
 * @example With auto-configuration
 * ```typescript
 * const transport = createOpenTelemetryTransport(baseTransport, {
 *   serviceName: "email-service",
 *   auto: {
 *     tracing: { endpoint: "http://jaeger:14268/api/traces" },
 *     metrics: { endpoint: "http://prometheus:9090/api/v1/write" }
 *   }
 * });
 * ```
 */
export declare function createOpenTelemetryTransport<TProviderId extends string = string>(
  baseTransport: Transport<TProviderId>,
  config?: CreateOpenTelemetryTransportConfig,
): OpenTelemetryTransport<TProviderId>;
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
export declare function createEmailAttributeExtractor(
  _transportName: string,
  options?: {
    readonly recordSensitiveData?: boolean;
    readonly transportVersion?: string;
    readonly customAttributes?: (
      operation: 'send' | 'send_batch',
      transportName: string,
      messageCount: number,
      totalSize?: number,
    ) => Record<string, string | number | boolean>;
  },
): AttributeExtractor;
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
export declare function createErrorClassifier(options?: {
  readonly patterns?: Record<string, RegExp>;
  readonly fallback?: string;
}): ErrorClassifier;
