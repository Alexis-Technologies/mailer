import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createMessage,
  type RawTransport,
  type Receipt,
  type Transport,
  type VerifiableTransport,
} from '../../index.js';
import { RateLimitTransport } from '../../src/ratelimit/index.js';

declare const inner: Transport<'ses'>;
const limiter = new RateLimitTransport(inner, {
  limit: 14,
  intervalMs: 1000,
  burst: 28,
  mode: 'wait',
  maxWaitMs: 5000,
  key: () => 'tenant',
  cost: () => 1,
  maxKeys: 100,
  now: () => Date.now(),
});
expectType<'ses'>(limiter.id);
expectAssignable<RawTransport<'ses'>>(limiter);
expectAssignable<VerifiableTransport<'ses'>>(limiter);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'ses'>>>(limiter.send(message));
expectType<AsyncIterable<Receipt<'ses'>>>(limiter.sendMany([message]));
expectError(new RateLimitTransport(inner, {}));
expectError(new RateLimitTransport(inner, { limit: 1, mode: 'drop' }));
new RateLimitTransport(inner, {
  limit: 14,
  store: { take: async () => ({ taken: false, waitMs: 70 }) },
});
// A pino-like logger, and a bound on the queue.
new RateLimitTransport(inner, { limit: 1, maxQueue: 100, logger: { info() {}, debug() {} } });
expectError(new RateLimitTransport(inner, { limit: 1, logger: 'pino' }));
expectError(new RateLimitTransport(inner, { limit: 1, maxQueue: '100' }));
