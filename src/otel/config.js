// Ported from upyo v0.7.0 (packages/opentelemetry/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { classifyReceiptError } = require('../core/receipt.js');

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
  metrics: {
    enabled: true,
    prefix: 'mailer',
    durationBuckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0],
  },
  tracing: {
    enabled: true,
    samplingRate: 1.0,
    recordSensitiveData: false,
    spanPrefix: 'email',
  },
};

// Options of upstream that set up exporters and resource attributes, which
// belong to the OpenTelemetry SDK of the application: it builds the providers
// passed in.  They were accepted and never read.
const SDK_OPTIONS = ['auto', 'serviceName', 'serviceVersion'];

/**
 * Creates a resolved OpenTelemetry configuration with defaults applied.
 *
 * @param config The input configuration options.
 * @returns A resolved configuration with all defaults applied.
 * @throws {Error} When tracing is enabled but no TracerProvider is provided.
 * @throws {Error} When metrics are enabled but no MeterProvider is provided.
 * @throws {TypeError} When `metrics.samplingRate`, `auto`, `serviceName` or
 *                     `serviceVersion` is set.
 */
const createOpenTelemetryConfig = (config = {}) => {
  for (const option of SDK_OPTIONS) {
    if (config[option] !== undefined) {
      throw new TypeError(
        `${option} is not supported: exporters and resource attributes are set up ` +
          'with the OpenTelemetry SDK of the application, whose providers are passed in.',
      );
    }
  }
  // Sampled counters and histograms undercount by the sampling rate, and a
  // sampled UpDownCounter drifts, so metrics are recorded for every operation
  // and only spans are sampled.
  if (config.metrics?.samplingRate !== undefined) {
    throw new TypeError(
      'metrics.samplingRate is not supported: metrics are recorded for every ' +
        'operation, and only spans are sampled (tracing.samplingRate).',
    );
  }
  const resolvedConfig = {
    tracerProvider: config.tracerProvider,
    meterProvider: config.meterProvider,
    metrics: {
      ...DEFAULT_CONFIG.metrics,
      ...config.metrics,
    },
    tracing: {
      ...DEFAULT_CONFIG.tracing,
      ...config.tracing,
    },
    attributeExtractor: config.attributeExtractor,
    errorClassifier: config.errorClassifier,
    random: config.random,
  };

  // Validate required providers
  if (resolvedConfig.tracing.enabled && !resolvedConfig.tracerProvider) {
    throw new Error(
      'TracerProvider is required when tracing is enabled. ' +
        'Provide tracerProvider in config or use auto-configuration.',
    );
  }

  if (resolvedConfig.metrics.enabled && !resolvedConfig.meterProvider) {
    throw new Error(
      'MeterProvider is required when metrics are enabled. ' +
        'Provide meterProvider in config or use auto-configuration.',
    );
  }

  return resolvedConfig;
};

/**
 * Default error classifier that categorizes errors into standard types: the
 * categories of a `ReceiptError`, from `classifyReceiptError` of the root
 * entry, so that a thrown error and a failed receipt are classified alike,
 * and `"aborted"` for an `AbortError`, which is a cancellation rather than a
 * failure of the transport.
 *
 * @example
 * ```typescript
 * import { defaultErrorClassifier } from "@alexify/mailer/otel";
 *
 * console.log(defaultErrorClassifier(new Error("401 Unauthorized"))); // "auth"
 * console.log(defaultErrorClassifier(new Error("Rate limit exceeded"))); // "rate-limit"
 * console.log(defaultErrorClassifier(new Error("Connection timeout"))); // "timeout"
 * console.log(defaultErrorClassifier(new Error("Invalid email format"))); // "validation"
 * console.log(defaultErrorClassifier(new Error("500 Internal Server Error"))); // "server-error"
 * console.log(defaultErrorClassifier(new Error("Something else"))); // "unknown"
 * ```
 *
 * @param error The error to classify.
 * @returns A category of `ReceiptError`, such as `"auth"`, `"rate-limit"`,
 *          `"network"`, `"timeout"`, `"validation"`, `"server-error"` or
 *          `"unknown"`, or `"aborted"`.
 */
const defaultErrorClassifier = (error) => {
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  return classifyReceiptError(error).category;
};

module.exports = { createOpenTelemetryConfig, defaultErrorClassifier };
