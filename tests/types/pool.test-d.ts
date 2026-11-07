import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createMessage,
  type RawTransport,
  type Receipt,
  type SmsMessage,
  type Transport,
  type VerifiableTransport,
} from '../../index.js';
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

// A pool of the transports of a channel takes its messages.
declare const twilio: Transport<'twilio', SmsMessage>;
declare const vonage: Transport<'vonage', SmsMessage>;
const sms = new PoolTransport({
  strategy: 'priority',
  transports: [
    { transport: twilio, priority: 2, selector: (message) => message.to.startsWith('+380') },
    { transport: vonage },
  ],
});
expectAssignable<VerifiableTransport<'twilio' | 'vonage' | 'pool', SmsMessage>>(sms);
declare const smsMessage: SmsMessage;
expectType<Promise<Receipt<'twilio' | 'vonage' | 'pool'>>>(sms.send(smsMessage));
expectAssignable<Strategy<'twilio', SmsMessage>>(new RoundRobinStrategy<'twilio', SmsMessage>());
declare const ses: Transport<'ses'>;
expectAssignable<RawTransport<'ses' | 'pool'>>(
  new PoolTransport({ strategy: 'priority', transports: [{ transport: ses }] }),
);
// The transports of several channels go in a router, not a pool.
expectError(
  new PoolTransport({
    strategy: 'priority',
    transports: [{ transport: ses }, { transport: twilio }],
  }),
);
