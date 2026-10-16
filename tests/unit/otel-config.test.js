// Ported from upyo v0.7.0 (packages/opentelemetry/src/config.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { describe, it } = require('node:test');
const { strict: assert } = require('node:assert');
const { createOpenTelemetryConfig, defaultErrorClassifier } = require('../../src/otel/config.js');
const { MockMeterProvider, MockTracerProvider } = require('../helpers/otel/mock-otel-providers.js');

describe('config', () => {
  describe('createOpenTelemetryConfig', () => {
    it('should create config with defaults', () => {
      const tracerProvider = new MockTracerProvider();
      const meterProvider = new MockMeterProvider();

      const config = createOpenTelemetryConfig({
        tracerProvider,
        meterProvider,
      });

      assert.equal(config.metrics.enabled, true);
      // Changed after the port: metrics have no sampling rate.
      assert.equal(config.metrics.samplingRate, undefined);
      assert.equal(config.metrics.prefix, 'mailer');
      assert.deepEqual(
        config.metrics.durationBuckets,
        [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0],
      );

      assert.equal(config.tracing.enabled, true);
      assert.equal(config.tracing.samplingRate, 1.0);
      assert.equal(config.tracing.recordSensitiveData, false);
      assert.equal(config.tracing.spanPrefix, 'email');
    });

    it('should merge custom configuration', () => {
      const tracerProvider = new MockTracerProvider();
      const meterProvider = new MockMeterProvider();

      const config = createOpenTelemetryConfig({
        tracerProvider,
        meterProvider,
        // Changed after the port: metrics.samplingRate is refused.
        metrics: {
          enabled: true,
          prefix: 'custom',
        },
        tracing: {
          enabled: true,
          recordSensitiveData: true,
          spanPrefix: 'custom_email',
        },
      });

      assert.equal(config.metrics.prefix, 'custom');
      assert.equal(config.tracing.recordSensitiveData, true);
      assert.equal(config.tracing.spanPrefix, 'custom_email');
    });

    it('should throw when tracing enabled without TracerProvider', () => {
      assert.throws(() => {
        createOpenTelemetryConfig({
          tracing: { enabled: true },
          // No tracerProvider
        });
      }, /TracerProvider is required when tracing is enabled/);
    });

    it('should throw when metrics enabled without MeterProvider', () => {
      assert.throws(() => {
        createOpenTelemetryConfig({
          tracing: { enabled: false },
          metrics: { enabled: true },
          // No meterProvider
        });
      }, /MeterProvider is required when metrics are enabled/);
    });

    it('should work with both disabled', () => {
      const config = createOpenTelemetryConfig({
        metrics: { enabled: false },
        tracing: { enabled: false },
      });

      assert.equal(config.metrics.enabled, false);
      assert.equal(config.tracing.enabled, false);
    });

    it('should preserve custom functions', () => {
      const tracerProvider = new MockTracerProvider();
      const meterProvider = new MockMeterProvider();
      const customExtractor = () => ({ custom: 'value' });
      const customClassifier = () => 'custom_error';

      const config = createOpenTelemetryConfig({
        tracerProvider,
        meterProvider,
        attributeExtractor: customExtractor,
        errorClassifier: customClassifier,
      });

      assert.equal(config.attributeExtractor, customExtractor);
      assert.equal(config.errorClassifier, customClassifier);
    });
  });

  describe('defaultErrorClassifier', () => {
    it('should classify authentication errors', () => {
      const errors = [
        new Error('Unauthorized access'),
        new Error('Invalid API key provided'),
        new Error('Authentication failed'),
        new Error('HTTP 403 Forbidden'),
      ];

      for (const error of errors) {
        const category = defaultErrorClassifier(error);
        assert.equal(category, 'auth', `Failed to classify: ${error.message}`);
      }
    });

    it('should classify rate limiting errors', () => {
      const errors = [
        new Error('Rate limit exceeded'),
        new Error('HTTP 429 Too Many Requests'),
        new Error('Quota exceeded for today'),
        new Error('Request throttled'),
      ];

      for (const error of errors) {
        const category = defaultErrorClassifier(error);
        assert.equal(category, 'rate-limit', `Failed to classify: ${error}`);
      }
    });

    it('should classify network errors', () => {
      const errors = [
        // Changed after the port: a timeout and an abort have categories of
        // their own (see "should tell timeouts and aborts" below).
        new Error('DNS resolution failed'),
        (() => {
          const e = new Error('Network is unreachable');
          e.name = 'NetworkError';
          return e;
        })(),
      ];

      for (const error of errors) {
        const category = defaultErrorClassifier(error);
        assert.equal(category, 'network', `Failed to classify: ${error.message}`);
      }
    });

    it('should classify validation errors', () => {
      const errors = [
        new Error('Invalid email address format'),
        new Error('Malformed request body'),
        new Error("Validation failed for field 'email'"),
        new Error('HTTP 400 Bad Request'),
      ];

      for (const error of errors) {
        const category = defaultErrorClassifier(error);
        assert.equal(category, 'validation', `Failed to classify: ${error}`);
      }
    });

    it('should classify service unavailable errors', () => {
      const errors = [
        new Error('HTTP 503 Service Unavailable'),
        new Error('Service temporarily unavailable'),
        new Error('Temporarily unavailable, try again later'),
      ];

      for (const error of errors) {
        const category = defaultErrorClassifier(error);
        assert.equal(category, 'service-unavailable', `Failed to classify: ${error}`);
      }
    });

    // Changed after the port: the classifier is that of the receipts.
    it('should tell timeouts and aborts', () => {
      const aborted = new Error('Operation was aborted');
      aborted.name = 'AbortError';
      assert.equal(defaultErrorClassifier(new Error('Connection timeout')), 'timeout');
      assert.equal(defaultErrorClassifier(new Error('HTTP 504 Gateway Timeout')), 'timeout');
      assert.equal(defaultErrorClassifier(aborted), 'aborted');
    });

    it('should classify server errors', () => {
      const errors = [
        new Error('HTTP 500 Internal Server Error'),
        new Error('HTTP 502 Bad Gateway'),
        new Error('Internal server error occurred'),
      ];

      for (const error of errors) {
        const category = defaultErrorClassifier(error);
        assert.equal(category, 'server-error', `Failed to classify: ${error}`);
      }
    });

    it('should classify unknown errors', () => {
      const errors = [
        new Error('Something unexpected happened'),
        { message: 'Unknown error' },
        'string error',
        123,
        null,
        undefined,
      ];

      for (const error of errors) {
        const category = defaultErrorClassifier(error);
        assert.equal(category, 'unknown', `Failed to classify: ${error}`);
      }
    });

    it('should be case insensitive', () => {
      const error1 = new Error('RATE LIMIT EXCEEDED');
      const error2 = new Error('Rate Limit Exceeded');
      const error3 = new Error('rate limit exceeded');

      assert.equal(defaultErrorClassifier(error1), 'rate-limit');
      assert.equal(defaultErrorClassifier(error2), 'rate-limit');
      assert.equal(defaultErrorClassifier(error3), 'rate-limit');
    });
  });
});
