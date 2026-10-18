import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createMessage,
  type RawTransport,
  type Receipt,
  type Transport,
  type VerifiableTransport,
} from '../../index.js';
import { CircuitBreakerTransport, type CircuitState } from '../../src/breaker/index.js';

declare const inner: Transport<'ses'>;
const breaker = new CircuitBreakerTransport(inner, {
  failureThreshold: 3,
  resetTimeoutMs: 10_000,
  isFailure: (receipt) => !receipt.successful,
  onStateChange: (state, previous) => {
    expectType<CircuitState>(state);
    expectType<CircuitState>(previous);
  },
  now: () => Date.now(),
});
expectType<'ses'>(breaker.id);
expectType<CircuitState>(breaker.state);
expectAssignable<RawTransport<'ses'>>(breaker);
expectAssignable<VerifiableTransport<'ses'>>(breaker);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'ses'>>>(breaker.send(message));
expectType<AsyncIterable<Receipt<'ses'>>>(breaker.sendMany([message]));
new CircuitBreakerTransport(inner);
expectError(new CircuitBreakerTransport(inner, { failureThreshold: '5' }));
// A pino-like logger, or none.
new CircuitBreakerTransport(inner, { logger: { warn() {}, info() {}, debug() {} } });
expectError(new CircuitBreakerTransport(inner, { logger: 'pino' }));
