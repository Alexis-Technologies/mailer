import { metrics, trace } from '@opentelemetry/api';
import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import { MockTransport } from '../../src/mock/index.js';
import {
  OpenTelemetryTransport,
  createEmailAttributeExtractor,
  createErrorClassifier,
  createOpenTelemetryTransport,
  defaultErrorClassifier,
  type MeterProvider,
  type OpenTelemetryConfig,
  type TracerProvider,
} from '../../src/otel/index.js';

// The providers of the OpenTelemetry API fit the structural types.
expectAssignable<TracerProvider>(trace.getTracerProvider());
expectAssignable<MeterProvider>(metrics.getMeterProvider());

const transport = createOpenTelemetryTransport(new MockTransport(), {
  tracerProvider: trace.getTracerProvider(),
  meterProvider: metrics.getMeterProvider(),
  tracing: { samplingRate: 0.5, recordSensitiveData: false },
  metrics: { prefix: 'billing' },
});
expectType<OpenTelemetryTransport<'mock'>>(transport);
expectAssignable<Transport<'mock'>>(transport);
expectAssignable<AsyncDisposable>(transport);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'mock'>>>(transport.send(message));
expectType<string>(defaultErrorClassifier(new Error('Timed out')));
expectAssignable<(error: unknown) => string>(createErrorClassifier({ patterns: {} }));
expectAssignable<OpenTelemetryConfig>({ tracing: { enabled: false }, metrics: { enabled: false } });
expectAssignable<Function>(createEmailAttributeExtractor);
expectError(new OpenTelemetryTransport(new MockTransport(), { tracerProvider: 'global' }));
// Metrics are recorded for every operation; only tracing has a sampling rate.
expectError(new OpenTelemetryTransport(new MockTransport(), { metrics: { samplingRate: 0.5 } }));
