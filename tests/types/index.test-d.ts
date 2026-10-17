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
  type MessageTracking,
  type Message,
  type RawTransport,
  type Receipt,
  type DeliveryBounce,
  type DeliveryEvent,
  type DeliveryEventType,
  type ReceiptError,
  type ReceiptErrorCategory,
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

// Scheduling, tracking and metadata.
const fields = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
  scheduledAt: new Date(),
  tracking: { opens: true },
  metadata: { orderId: '42' },
});
expectType<Date | undefined>(fields.scheduledAt);
expectType<MessageTracking | undefined>(fields.tracking);
expectType<Readonly<Record<string, string>> | undefined>(fields.metadata);
expectError(
  createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'x',
    content: { text: 'x' },
    metadata: { orderId: 42 },
  }),
);

// The List-* fields of a newsletter.
createMessage({
  from: 'news@example.com',
  to: 'reader@example.com',
  subject: 'Weekly',
  content: { text: 'Hi' },
  list: {
    id: { id: 'news.example.com', name: 'Weekly News' },
    unsubscribe: ['https://example.com/u', { url: 'unsub@example.com', comment: 'mail' }],
    help: 'https://example.com/help',
    oneClick: true,
  },
});
expectError(
  createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'x',
    content: { text: 'x' },
    list: { unsubscribe: 42 },
  }),
);
expectError(
  createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'x',
    content: { text: 'x' },
    list: { oneClick: 'yes' },
  }),
);

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
// A message this transport cannot send as it is, which a pool fails over with.
const unsupported = createFailedReceipt('Postmark takes one tag per message.', {
  provider: 'postmark',
  category: 'unsupported',
  retryable: false,
});
if (!unsupported.successful) {
  expectAssignable<ReceiptErrorCategory | undefined>(unsupported.errors?.[0]?.category);
}
expectAssignable<ReceiptErrorCategory>('unsupported');
expectError(createReceiptError('x', { category: 'not-supported' }));

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

// The events of ./webhooks: one per recipient, the type a closed union.
const event = {} as DeliveryEvent<'ses'>;
expectType<'ses'>(event.provider);
expectType<DeliveryEventType>(event.type);
expectType<'hard' | 'soft' | 'undetermined' | undefined>(event.bounce?.kind);
expectType<readonly string[]>(event.tags);
expectAssignable<DeliveryBounce>({ kind: 'hard', code: '5.1.1' });
expectError<DeliveryEventType>('sent');
