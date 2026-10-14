// Ported from upyo v0.7.0 (packages/opentelemetry/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
  metrics: {
    enabled: true,
    samplingRate: 1.0,
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

/**
 * Creates a resolved OpenTelemetry configuration with defaults applied.
 *
 * @param config The input configuration options.
 * @returns A resolved configuration with all defaults applied.
 * @throws {Error} When tracing is enabled but no TracerProvider is provided.
 * @throws {Error} When metrics are enabled but no MeterProvider is provided.
 */
const createOpenTelemetryConfig = (config = {}) => {
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
const defaultErrorClassifier = (error) => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Authentication errors
    if (
      message.includes('auth') ||
      message.includes('unauthorized') ||
      message.includes('invalid api key') ||
      message.includes('403')
    ) {
      return 'auth';
    }

    // Rate limiting
    if (
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('quota exceeded') ||
      message.includes('throttle')
    ) {
      return 'rate-limit';
    }

    // Server errors (check before network errors to catch "504 Gateway Timeout")
    if (
      message.includes('500') ||
      message.includes('502') ||
      message.includes('504') ||
      message.includes('internal server error')
    ) {
      return 'server-error';
    }

    // Network errors
    if (
      name.includes('network') ||
      message.includes('connect') ||
      message.includes('timeout') ||
      message.includes('dns') ||
      name === 'aborterror'
    ) {
      return 'network';
    }

    // Validation errors
    if (
      message.includes('invalid') ||
      message.includes('malformed') ||
      message.includes('validation') ||
      message.includes('400')
    ) {
      return 'validation';
    }

    // Service unavailable
    if (
      message.includes('503') ||
      message.includes('service unavailable') ||
      message.includes('temporarily unavailable')
    ) {
      return 'service-unavailable';
    }
  }

  // Fallback category
  return 'unknown';
};

module.exports = { createOpenTelemetryConfig, defaultErrorClassifier };
