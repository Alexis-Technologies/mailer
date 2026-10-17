import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import { MockTransport } from '../../src/mock/index.js';
import { RetryTransport, createRetryTransport, type RetryConfig } from '../../src/retry/index.js';

const base = new MockTransport();
const transport = createRetryTransport(base, {
  maxAttempts: 5,
  backoff: { baseDelayMilliseconds: 500, maxDelayMilliseconds: 10_000, factor: 2 },
  jitter: 'full',
  shouldRetry: (failure) => failure.kind === 'receipt',
});
expectType<RetryTransport<'mock'>>(transport);
expectAssignable<Transport<'mock'>>(transport);
expectAssignable<AsyncDisposable>(transport);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'mock'>>>(transport.send(message));
expectAssignable<RetryConfig>({ sendMany: { maxConcurrent: 4, intervalMilliseconds: 100 } });
expectError(createRetryTransport(base, { maxAttempts: '3' }));
