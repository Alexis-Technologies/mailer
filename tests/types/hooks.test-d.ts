import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createMessage,
  type RawMessage,
  type RawTransport,
  type SmsMessage,
  type Receipt,
  type Transport,
  type VerifiableTransport,
} from '../../index.js';
import { HooksTransport, type HookContext } from '../../src/hooks/index.js';

declare const inner: Transport<'postmark'>;
const hooked = new HooksTransport(inner, {
  beforeSend: async (message, context) => {
    expectType<HookContext>(context);
    return message.subject === '' ? undefined : message;
  },
  beforeSendRaw: (raw) => raw,
  afterSend: (receipt, _message, context) => {
    expectType<Receipt>(receipt);
    expectType<'send' | 'sendMany' | 'sendRaw'>(context.operation);
  },
  onRetry: (event) => {
    expectType<number>(event.attempt);
  },
  onError: async () => {},
  now: () => 0,
});
expectType<'postmark'>(hooked.id);
expectAssignable<RawTransport<'postmark'>>(hooked);
expectAssignable<VerifiableTransport<'postmark'>>(hooked);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'postmark'>>>(hooked.send(message));
expectType<AsyncIterable<Receipt<'postmark'>>>(hooked.sendMany([message]));
new HooksTransport(inner);
expectError(new HooksTransport(inner, { afterSend: 'log' }));

// The hooks of a transport of a channel take its messages.
declare const twilio: Transport<'twilio', SmsMessage>;
const sms = new HooksTransport(twilio, {
  beforeSend: (message) => {
    expectType<SmsMessage>(message);
    return { ...message, text: `${message.text ?? ''} (STOP to opt out)` };
  },
  afterSend: (_receipt, message) => {
    expectType<SmsMessage | RawMessage>(message);
  },
});
expectAssignable<VerifiableTransport<'twilio', SmsMessage>>(sms);
expectError(sms.send(message));
expectError(new HooksTransport(twilio, { beforeSend: () => message }));
