import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Message, type Receipt, type Transport } from '../../index.js';
import { MockTransport, type MockConfig } from '../../src/mock/index.js';

const transport = new MockTransport({ delay: 10, failureRate: 0.1 });
expectAssignable<Transport<'mock'>>(transport);
expectType<'mock'>(transport.id);
expectAssignable<MockTransport>(new MockTransport());

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'mock'>>>(transport.send(message));
expectType<readonly Message[]>(transport.getSentMessages());
expectType<Message | undefined>(transport.getLastSentMessage());
expectType<Promise<Message>>(transport.waitForMessage((sent) => sent.subject === 'Hello'));

expectAssignable<MockConfig>({ randomDelayRange: { min: 1, max: 5 } });
expectError(new MockTransport({ delay: '10' }));
expectError(transport.setNextResponse({ successful: true }));
