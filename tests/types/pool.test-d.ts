import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt } from '../../index.js';
import { MockTransport } from '../../src/mock/index.js';
import {
  PoolTransport,
  type PoolVerification,
  PriorityStrategy,
  RoundRobinStrategy,
  SelectorStrategy,
  WeightedStrategy,
  type PoolConfig,
  type Strategy,
} from '../../src/pool/index.js';

const primary = new MockTransport();
const backup = new MockTransport();
const pool = new PoolTransport({
  strategy: 'priority',
  transports: [
    { transport: primary, priority: 10 },
    { transport: backup, priority: 1, selector: (message) => message.priority === 'high' },
  ],
  maxRetries: 1,
  timeout: 5000,
});
expectType<'pool'>(pool.id);
expectAssignable<AsyncDisposable>(pool);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'mock' | 'pool'>>>(pool.send(message));

for (const strategy of [
  new RoundRobinStrategy(),
  new WeightedStrategy(),
  new PriorityStrategy(),
  new SelectorStrategy(),
]) {
  expectAssignable<Strategy>(strategy);
}
expectAssignable<PoolConfig>({ strategy: new RoundRobinStrategy(), transports: [] });
expectError(new PoolTransport({ strategy: 'random', transports: [] }));
// continueOnSuccess was never read, and honored would deliver a message twice.
expectError(
  new PoolTransport({
    strategy: 'priority',
    transports: [{ transport: new MockTransport() }],
    continueOnSuccess: true,
  }),
);

const verified = await pool.verifyAll();
expectType<PoolVerification[]>(verified);
expectType<'verified' | 'failed' | 'unverifiable'>(verified[0].status);
