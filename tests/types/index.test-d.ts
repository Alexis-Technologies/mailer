import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createFailedReceipt,
  createMessage,
  createReceiptError,
  generateMessageId,
  isRawTransport,
  isVerifiableTransport,
  parseAddress,
  RawMessageValidationError,
  type Address,
  type IdGenerator,
  type IdKind,
  type Message,
  type RawTransport,
  type Receipt,
  type ReceiptError,
  type RetryEvent,
  type Transport,
  type VerifiableTransport,
} from '../../index.js';

// The message model.
const message = createMessage({
  from: 'Alex <alex@example.com>',
  to: ['bob@example.com', { address: 'carol@example.com' }],
  subject: 'Hello',
  content: { text: 'Hi', html: '<p>Hi</p>' },
});
expectType<Message>(message);
expectType<Address>(message.sender);
expectType<readonly Address[]>(message.recipients);
expectError(createMessage({ from: 'alex@example.com', subject: 'Hello' }));
expectError(createMessage({ from: 'alex', to: 'bob@example.com', subject: 'x', content: {} }));
expectType<Address | undefined>(parseAddress('Alex <alex@example.com>'));

// A receipt narrows on `successful`.
const receipt = {} as Receipt<'smtp'>;
if (receipt.successful) {
  expectType<string>(receipt.messageId);
} else {
  expectType<readonly string[]>(receipt.errorMessages);
}

// The provider id flows through errors, receipts and transports
// (receipt.test.ts of upstream checks the same at the type level).
const typedError: ReceiptError<'mailgun'> = createReceiptError('Too many requests', {
  provider: 'mailgun',
  statusCode: 429,
});
expectType<'mailgun' | undefined>(typedError.provider);
const typedReceipt: Receipt<'sendgrid'> = createFailedReceipt('Too many requests', {
  provider: 'sendgrid',
  statusCode: 429,
});
expectType<'sendgrid' | undefined>(typedReceipt.provider);
const unknownDelivery = createFailedReceipt('Connection closed after DATA', {
  deliveryUnknown: true,
});
if (!unknownDelivery.successful) {
  expectType<boolean | undefined>(unknownDelivery.deliveryUnknown);
}

const transport: Transport<'smtp'> = {
  id: 'smtp',
  send: () => Promise.resolve({ successful: true, messageId: 'message-id', provider: 'smtp' }),
  async *sendMany() {
    yield { successful: true, messageId: 'message-id', provider: 'smtp' } as const;
  },
};
expectType<'smtp'>(transport.id);
if (isRawTransport(transport)) expectType<RawTransport<'smtp'>>(transport);
if (isVerifiableTransport(transport)) expectType<VerifiableTransport<'smtp'>>(transport);

expectAssignable<TypeError>(new RawMessageValidationError('Bad line.', 'content', 12, 2));

// onRetry hears each retry of a transport and of the decorators around it.
declare const retried: Transport;
expectType<Promise<Receipt>>(
  retried.send(
    createMessage({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 's',
      content: { text: 't' },
    }),
    {
      onRetry: (event: RetryEvent) => {
        expectType<number>(event.attempt);
        expectType<number>(event.delayMilliseconds);
        expectType<unknown>(event.error);
      },
    },
  ),
);

// generateId makes the identifiers of a kind, the left half of a Message-ID.
const ulid: IdGenerator = (kind: IdKind) => `01J${kind.length}`;
expectType<string>(generateMessageId('example.com', { generateId: ulid }));
expectError(generateMessageId('example.com', { generateId: () => 42 }));
