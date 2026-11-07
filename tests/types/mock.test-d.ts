import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createMessage,
  type AnyMessage,
  type Message,
  type RawTransport,
  type Receipt,
  type SmsMessage,
  type Transport,
} from '../../index.js';
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

// A mock of email sends raw MIME too; one of a channel takes its messages.
expectAssignable<RawTransport<'mock'>>(new MockTransport());
const sms = new MockTransport<SmsMessage>();
expectAssignable<Transport<'mock', SmsMessage>>(sms);
expectType<readonly SmsMessage[]>(sms.getMessagesTo('+380671234567'));
expectError(sms.send(message));
const every = new MockTransport<AnyMessage>();
expectType<readonly SmsMessage[]>(every.getMessagesByChannel('sms'));
expectType<readonly Message[]>(every.getMessagesBySubject('Hello'));
expectType<readonly Message[]>(every.getMessagesByChannel('email'));
expectError(every.getMessagesByChannel('fax'));
expectType<readonly never[]>(transport.getMessagesByChannel('sms'));
