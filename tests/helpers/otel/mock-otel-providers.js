// Ported from upyo v0.7.0 (packages/opentelemetry/src/test-utils/mock-otel-providers.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Mock implementation of OpenTelemetry Span for testing.
 */
class MockSpan {
  events = [];
  attributes = {};
  status;
  ended = false;
  name = '';

  spanContext() {
    return {
      traceId: 'mock-trace-id',
      spanId: 'mock-span-id',
      traceFlags: 1,
    };
  }

  setAttribute(key, value) {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attributes) {
    Object.assign(this.attributes, attributes);
    return this;
  }

  addEvent(name, attributesOrStartTime, startTime) {
    this.events.push({
      name,
      attributes:
        typeof attributesOrStartTime === 'object' && attributesOrStartTime !== null
          ? attributesOrStartTime
          : undefined,
      timestamp: typeof attributesOrStartTime === 'number' ? attributesOrStartTime : startTime,
    });
    return this;
  }

  setStatus(status) {
    this.status = status;
    return this;
  }

  updateName(name) {
    this.attributes['span.name'] = name;
    return this;
  }

  end(endTime) {
    this.ended = true;
    if (endTime) {
      this.attributes['span.end_time'] = endTime;
    }
  }

  isRecording() {
    return !this.ended;
  }

  recordException(exception, time) {
    const errorLike = exception;
    this.addEvent(
      'exception',
      {
        'exception.type': errorLike?.constructor?.name || 'unknown',
        'exception.message': errorLike?.message || String(exception),
      },
      time,
    );
  }

  addLink() {
    return this;
  }

  addLinks() {
    return this;
  }
}

/**
 * Mock implementation of OpenTelemetry Tracer for testing.
 */
class MockTracer {
  spans = [];

  startSpan(name, options) {
    const span = new MockSpan();
    span.name = name;
    span.attributes['span.name'] = name;
    if (options?.kind !== undefined) {
      span.attributes['span.kind'] = options.kind;
    }
    this.spans.push(span);
    return span;
  }

  startActiveSpan(name, optionsOrFn, contextOrFn, fn) {
    let actualFn = fn;
    if (typeof optionsOrFn === 'function') actualFn = optionsOrFn;
    else if (typeof contextOrFn === 'function') actualFn = contextOrFn;
    const span = this.startSpan(name, typeof optionsOrFn === 'object' ? optionsOrFn : undefined);
    return actualFn(span);
  }

  /**
   * Test helper to get the last created span.
   */
  getLastSpan() {
    return this.spans[this.spans.length - 1];
  }

  /**
   * Test helper to clear all spans.
   */
  clearSpans() {
    this.spans.length = 0;
  }
}

/**
 * Mock implementation of OpenTelemetry TracerProvider for testing.
 */
class MockTracerProvider {
  tracers = [];

  getTracer(_name, _version) {
    const tracer = new MockTracer();
    this.tracers.push(tracer);
    return tracer;
  }

  /**
   * Test helper to get all spans from all tracers.
   */
  getAllSpans() {
    return this.tracers.flatMap((tracer) => tracer.spans);
  }

  /**
   * Test helper to clear all tracers and spans.
   */
  clear() {
    this.tracers.forEach((tracer) => tracer.clearSpans());
    this.tracers.length = 0;
  }
}

// Changed after the port: an instrument keeps its name and options, so that
// tests can tell the instruments apart.
class MockMetricInstrument {
  records = [];

  constructor(name, options) {
    this.name = name;
    this.options = options;
  }

  record(value, attributes) {
    this.records.push({ value, attributes });
  }

  /**
   * Test helper to get total recorded value.
   */
  getTotalValue() {
    return this.records.reduce((sum, record) => sum + record.value, 0);
  }

  /**
   * Test helper to clear all records.
   */
  clear() {
    this.records.length = 0;
  }
}

/**
 * Mock implementation of OpenTelemetry Counter for testing.
 */
class MockCounter extends MockMetricInstrument {
  add(value, attributes) {
    this.record(value, attributes);
  }
}

/**
 * Mock implementation of OpenTelemetry UpDownCounter for testing.
 */
class MockUpDownCounter extends MockMetricInstrument {
  add(value, attributes) {
    this.record(value, attributes);
  }
}

/**
 * Mock implementation of OpenTelemetry Histogram for testing.
 */
class MockHistogram extends MockMetricInstrument {
  record(value, attributes) {
    super.record(value, attributes);
  }
}

/**
 * Mock implementation of OpenTelemetry Meter for testing.
 */
class MockMeter {
  counters = [];
  upDownCounters = [];
  histograms = [];

  createCounter(name, options) {
    const counter = new MockCounter(name, options);
    this.counters.push(counter);
    return counter;
  }

  createUpDownCounter(name, options) {
    const upDownCounter = new MockUpDownCounter(name, options);
    this.upDownCounters.push(upDownCounter);
    return upDownCounter;
  }

  createHistogram(name, options) {
    const histogram = new MockHistogram(name, options);
    this.histograms.push(histogram);
    return histogram;
  }

  createObservableCounter(_name, _options) {
    throw new Error('Observable instruments not implemented in mock');
  }

  createObservableUpDownCounter(_name, _options) {
    throw new Error('Observable instruments not implemented in mock');
  }

  createObservableGauge(_name, _options) {
    throw new Error('Observable instruments not implemented in mock');
  }

  createGauge(_name, _options) {
    throw new Error('Gauge not implemented in mock');
  }

  addBatchObservableCallback(_callback, _observables) {
    throw new Error('Observable instruments not implemented in mock');
  }

  removeBatchObservableCallback(_callback) {
    throw new Error('Observable instruments not implemented in mock');
  }

  /**
   * Test helper to clear all metric instruments.
   */
  clear() {
    this.counters.forEach((c) => c.clear());
    this.upDownCounters.forEach((c) => c.clear());
    this.histograms.forEach((c) => c.clear());
    this.counters.length = 0;
    this.upDownCounters.length = 0;
    this.histograms.length = 0;
  }
}

/**
 * Mock implementation of OpenTelemetry MeterProvider for testing.
 */
class MockMeterProvider {
  meters = [];

  getMeter(_name, _version, _options) {
    const meter = new MockMeter();
    this.meters.push(meter);
    return meter;
  }

  /**
   * Test helper to get all metric records from all meters.
   */
  getAllRecords() {
    const allRecords = [];

    this.meters.forEach((meter) => {
      meter.counters.forEach((counter) => {
        allRecords.push({
          instrument: 'counter',
          name: counter.name,
          options: counter.options,
          records: [...counter.records],
        });
      });
      meter.upDownCounters.forEach((upDownCounter) => {
        allRecords.push({
          instrument: 'upDownCounter',
          name: upDownCounter.name,
          options: upDownCounter.options,
          records: [...upDownCounter.records],
        });
      });
      meter.histograms.forEach((histogram) => {
        allRecords.push({
          instrument: 'histogram',
          name: histogram.name,
          options: histogram.options,
          records: [...histogram.records],
        });
      });
    });

    return allRecords;
  }

  /**
   * Test helper to clear all meters and their instruments.
   */
  clear() {
    this.meters.forEach((meter) => meter.clear());
    this.meters.length = 0;
  }
}

module.exports = {
  MockSpan,
  MockTracer,
  MockTracerProvider,
  MockCounter,
  MockUpDownCounter,
  MockHistogram,
  MockMeter,
  MockMeterProvider,
};
