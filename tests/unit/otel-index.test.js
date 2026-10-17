// Ported from upyo v0.7.0 (packages/opentelemetry/src/index.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { describe, it } = require('node:test');
const { strict: assert } = require('node:assert');
const {
  createEmailAttributeExtractor,
  createErrorClassifier,
  createOpenTelemetryTransport,
  OpenTelemetryTransport,
} = require('../../src/otel/index.js');
const { createTestSetup } = require('../helpers/otel/test-config.js');

describe('index', () => {
  describe('createOpenTelemetryTransport', () => {
    it('should create transport with default service name', () => {
      const setup = createTestSetup();
      const transport = createOpenTelemetryTransport(setup.mockTransport, {
        tracerProvider: setup.tracerProvider,
        meterProvider: setup.meterProvider,
      });

      assert.ok(transport instanceof OpenTelemetryTransport);
    });

    // Changed after the port: the service name and version, and the auto
    // configuration, were accepted and never read; they belong to the SDK
    // that builds the providers, and are refused.
    it('should use custom service name and version', () => {
      const setup = createTestSetup();
      assert.throws(
        () =>
          createOpenTelemetryTransport(setup.mockTransport, {
            tracerProvider: setup.tracerProvider,
            meterProvider: setup.meterProvider,
            serviceName: 'my-email-service',
            serviceVersion: '1.2.3',
          }),
        { name: 'TypeError', message: /^serviceName is not supported/ },
      );
    });

    it('should work with auto configuration', () => {
      const setup = createTestSetup();
      assert.throws(
        () =>
          createOpenTelemetryTransport(setup.mockTransport, {
            tracerProvider: setup.tracerProvider,
            meterProvider: setup.meterProvider,
            auto: {
              tracing: { endpoint: 'http://jaeger:14268/api/traces' },
              metrics: { endpoint: 'http://prometheus:9090/api/v1/write' },
            },
          }),
        { name: 'TypeError', message: /^auto is not supported/ },
      );
    });

    // Changed in the port: the providers are passed in, with no fallback to
    // the global providers of @opentelemetry/api, so the minimal configuration
    // names them, and none at all is refused while tracing is enabled.
    it('should work with minimal configuration', () => {
      const setup = createTestSetup();
      const transport = createOpenTelemetryTransport(setup.mockTransport, {
        tracerProvider: setup.tracerProvider,
        meterProvider: setup.meterProvider,
      });

      assert.ok(transport instanceof OpenTelemetryTransport);
      assert.throws(
        () => createOpenTelemetryTransport(setup.mockTransport),
        /TracerProvider is required when tracing is enabled/,
      );
    });

    it('should merge configuration correctly', () => {
      const setup = createTestSetup();
      const transport = createOpenTelemetryTransport(setup.mockTransport, {
        tracerProvider: setup.tracerProvider,
        meterProvider: setup.meterProvider,
        metrics: { prefix: 'custom' },
        tracing: { recordSensitiveData: true },
      });

      assert.equal(transport.config.metrics.prefix, 'custom');
      assert.equal(transport.config.tracing.recordSensitiveData, true);
    });
  });

  describe('createEmailAttributeExtractor', () => {
    it('should create basic attribute extractor', () => {
      const extractor = createEmailAttributeExtractor('test-transport');

      const attributes = extractor('send', 'test-transport', 1, 1000);

      assert.equal(typeof attributes, 'object');
    });

    it('should include custom attributes', () => {
      const extractor = createEmailAttributeExtractor('test-transport', {
        recordSensitiveData: true,
        transportVersion: '2.0.0',
        customAttributes: (operation, transportName, messageCount, totalSize) => ({
          'app.version': '1.0.0',
          'app.environment': 'test',
          'operation.custom': operation,
          'transport.custom': transportName,
          'batch.custom_size': messageCount,
          'size.custom': totalSize || 0,
        }),
      });

      const attributes = extractor('send_batch', 'test-transport', 5, 2500);

      assert.equal(attributes['app.version'], '1.0.0');
      assert.equal(attributes['app.environment'], 'test');
      assert.equal(attributes['operation.custom'], 'send_batch');
      assert.equal(attributes['transport.custom'], 'test-transport');
      assert.equal(attributes['batch.custom_size'], 5);
      assert.equal(attributes['size.custom'], 2500);
    });

    it('should work without custom attributes', () => {
      const extractor = createEmailAttributeExtractor('test-transport', {
        recordSensitiveData: false,
      });

      const attributes = extractor('send', 'test-transport', 1);

      assert.equal(typeof attributes, 'object');
      // Should not throw and should return an object
    });

    it('should handle different operations', () => {
      const extractor = createEmailAttributeExtractor('test-transport', {
        customAttributes: (operation) => ({ 'current.operation': operation }),
      });

      const sendAttributes = extractor('send', 'test-transport', 1);
      const batchAttributes = extractor('send_batch', 'test-transport', 3);

      assert.equal(sendAttributes['current.operation'], 'send');
      assert.equal(batchAttributes['current.operation'], 'send_batch');
    });
  });

  describe('createErrorClassifier', () => {
    it('should create basic error classifier', () => {
      const classifier = createErrorClassifier();

      const category = classifier(new Error('Some error'));

      assert.equal(typeof category, 'string');
    });

    it('should use custom patterns', () => {
      const classifier = createErrorClassifier({
        patterns: {
          custom_spam: /spam|blocked|reputation/i,
          custom_bounce: /bounce|undeliverable|invalid.*recipient/i,
        },
        fallback: 'custom_unknown',
      });

      assert.equal(classifier(new Error('Message blocked as spam')), 'custom_spam');
      assert.equal(classifier(new Error('Email bounced back')), 'custom_bounce');
      assert.equal(classifier(new Error('Invalid recipient address')), 'custom_bounce');
    });

    it('should fall back to default classifier', () => {
      const classifier = createErrorClassifier({
        patterns: {
          custom_error: /very_specific_pattern/,
        },
      });

      // Should fall back to default classifier for rate limit
      assert.equal(classifier(new Error('Rate limit exceeded')), 'rate-limit');

      // Should use default fallback for unmatched errors
      assert.equal(classifier(new Error('Something else')), 'unknown');
    });

    it('should use custom fallback', () => {
      const classifier = createErrorClassifier({
        patterns: {
          never_matches: /this_will_never_match_anything_specific_12345/,
        },
        fallback: 'my_custom_fallback',
      });

      const category = classifier(new Error('Random error'));
      assert.equal(category, 'my_custom_fallback');
    });

    it('should be case insensitive for custom patterns', () => {
      const classifier = createErrorClassifier({
        patterns: {
          spam_error: /spam/i,
        },
      });

      assert.equal(classifier(new Error('SPAM detected')), 'spam_error');
      assert.equal(classifier(new Error('Spam detected')), 'spam_error');
      assert.equal(classifier(new Error('spam detected')), 'spam_error');
    });

    it('should handle non-Error objects', () => {
      const classifier = createErrorClassifier({
        patterns: {
          string_error: /string/,
        },
        fallback: 'non_error',
      });

      assert.equal(classifier('string error'), 'non_error');
      assert.equal(classifier(123), 'non_error');
      assert.equal(classifier(null), 'non_error');
    });

    it('should prioritize custom patterns over default', () => {
      const classifier = createErrorClassifier({
        patterns: {
          custom_auth: /auth/i, // This should override default auth classification
        },
      });

      const category = classifier(new Error('Authentication failed'));
      assert.equal(category, 'custom_auth');
    });

    it('should work with multiple overlapping patterns', () => {
      const classifier = createErrorClassifier({
        patterns: {
          first_pattern: /error.*failed/i,
          second_pattern: /failed.*error/i,
        },
      });

      // Should match the first pattern that matches
      const category = classifier(new Error('Error authentication failed'));
      assert.equal(category, 'first_pattern');
    });
  });
});
