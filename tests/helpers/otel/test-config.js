// Ported from upyo v0.7.0 (packages/opentelemetry/src/test-utils/test-config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { MockMeterProvider, MockTracerProvider } = require('./mock-otel-providers.js');

/**
 * Mock transport implementation for testing OpenTelemetry integration.
 */
class MockTransport {
  id = 'mock';

  sentMessages = [];
  nextReceipt = null;
  shouldThrow = null;
  delay = 0;
  messageIdCounter = 1;

  /**
   * Configures the next receipt to be returned.
   */
  setNextReceipt(receipt) {
    this.nextReceipt = receipt;
  }

  /**
   * Configures the transport to throw an error on the next send.
   */
  setThrowError(error) {
    this.shouldThrow = error;
  }

  /**
   * Sets a delay for send operations (useful for testing timeouts).
   */
  setDelay(ms) {
    this.delay = ms;
  }

  async send(message, options) {
    // Check for abort signal
    if (options?.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    // Simulate delay
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }

    // Check for abort signal after delay
    if (options?.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    // Throw configured error if set
    if (this.shouldThrow) {
      const error = this.shouldThrow;
      this.shouldThrow = null; // Reset for next call
      throw error;
    }

    this.sentMessages.push(message);

    // Return configured receipt or default success
    if (this.nextReceipt) {
      const receipt = this.nextReceipt;
      this.nextReceipt = null; // Reset for next call
      return receipt;
    }

    return {
      successful: true,
      messageId: `test-msg-${this.messageIdCounter++}`,
      provider: 'mock',
    };
  }

  async *sendMany(messages, options) {
    for await (const message of messages) {
      yield await this.send(message, options);
    }
  }

  /**
   * Resets the transport state for the next test.
   */
  reset() {
    this.sentMessages.length = 0;
    this.nextReceipt = null;
    this.shouldThrow = null;
    this.delay = 0;
    this.messageIdCounter = 1;
  }
}

/**
 * Creates a complete test setup with mock providers and transport.
 */
const createTestSetup = () => {
  const tracerProvider = new MockTracerProvider();
  const meterProvider = new MockMeterProvider();
  const mockTransport = new MockTransport();

  const config = {
    tracerProvider,
    meterProvider,
    metrics: { enabled: true },
    tracing: { enabled: true },
  };

  return {
    mockTransport,
    tracerProvider,
    meterProvider,
    config,
  };
};

/**
 * Creates a test message for testing purposes.
 */
const createTestMessage = (overrides = {}) => {
  return {
    sender: { address: 'sender@example.com' },
    recipients: [
      { address: 'recipient1@example.com' },
      { address: 'recipient2@example.com' },
      { address: 'recipient3@example.com' },
    ],
    ccRecipients: [],
    bccRecipients: [],
    replyRecipients: [],
    subject: 'Test Subject',
    content: { text: 'Test body content' },
    priority: 'normal',
    attachments: [
      {
        inline: false,
        filename: 'test1.txt',
        content: Promise.resolve(new Uint8Array([1, 2, 3])),
        contentType: 'text/plain',
        contentId: 'test1@example.com',
      },
      {
        inline: false,
        filename: 'test2.txt',
        content: Promise.resolve(new Uint8Array([4, 5, 6])),
        contentType: 'text/plain',
        contentId: 'test2@example.com',
      },
    ],
    tags: [],
    headers: new Headers(),
    ...overrides,
  };
};

/**
 * Utility functions for test assertions.
 */
const assertions = {
  /**
   * Asserts that a span with the given name exists and returns it.
   */
  hasSpan(spans, name, attributes) {
    const span = spans.find((s) => s.name === name);
    if (!span) {
      throw new Error(`Expected span with name '${name}' not found`);
    }

    if (attributes) {
      for (const [key, expectedValue] of Object.entries(attributes)) {
        const actualValue = span.attributes[key];
        if (actualValue !== expectedValue) {
          throw new Error(
            `Expected span attribute '${key}' to be '${expectedValue}', got '${actualValue}'`,
          );
        }
      }
    }

    return span;
  },

  /**
   * Asserts that a metric with the given name exists and optionally checks the count.
   */
  hasMetric(metrics, instrumentType, expectedCount) {
    const matchingMetrics = metrics.filter((m) => m.instrument === instrumentType);
    if (matchingMetrics.length === 0) {
      throw new Error(
        `Expected metric of type '${instrumentType}' not found. Available types: ${metrics
          .map((m) => m.instrument)
          .join(', ')}`,
      );
    }

    if (expectedCount !== undefined) {
      const totalCount = matchingMetrics.reduce((sum, metric) => {
        return sum + metric.records.length;
      }, 0);

      if (totalCount !== expectedCount) {
        throw new Error(
          `Expected ${expectedCount} metric records for '${instrumentType}', but found ${totalCount}`,
        );
      }
    }

    return matchingMetrics[0];
  },
};

/**
 * Extracts all spans from a mock tracer provider.
 */
const extractSpans = (tracerProvider) => {
  return tracerProvider.getAllSpans();
};

/**
 * Extracts all metrics from a mock meter provider.
 */
const extractMetrics = (meterProvider) => {
  return meterProvider.getAllRecords();
};

module.exports = {
  MockTransport,
  createTestSetup,
  createTestMessage,
  assertions,
  extractSpans,
  extractMetrics,
};
