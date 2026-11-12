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
  type AnyMessage,
  type Channel,
  type ChannelMessage,
  type E164,
  type IdGenerator,
  type IdKind,
  type MessageTracking,
  type Message,
  type MessageOf,
  type PushMessage,
  type RawTransport,
  type Receipt,
  type DeliveryBounce,
  type DeliveryEvent,
  type DeliveryUnknownReason,
  type DeliveryEventType,
  type ReceiptError,
  type ReceiptErrorCategory,
  type RetryEvent,
  type SlackMessage,
  type SmsMessage,
  type TelegramMessage,
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
expectType<'email'>(message.channel);
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

// The tenant of a message, beside its fields.
const tenanted = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
  tenantId: 'acme',
});
expectType<string | undefined>(tenanted.tenantId);
expectError(
  createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'x',
    content: { text: 'x' },
    tenantId: 42,
  }),
);

// The messages of the channels: one type each, told apart by `channel`.
const sms: SmsMessage = {
  channel: 'sms',
  to: '+380671234567',
  text: 'Your code is 1234',
  tags: [],
  priority: 'high',
};
expectType<E164>(sms.to);
expectError<SmsMessage>({ channel: 'sms', to: '0671234567', tags: [], priority: 'high' });
expectError<SmsMessage>({ channel: 'sms', to: '+380671234567' });
expectType<SmsMessage>({} as MessageOf<'sms'>);
expectType<Message>({} as MessageOf<'email'>);
expectAssignable<TelegramMessage>({ channel: 'telegram', to: 42, tags: [], priority: 'normal' });
expectAssignable<SlackMessage>({
  channel: 'slack',
  text: 'Deployed',
  payload: { blocks: [{ type: 'section' }] },
  mentions: { everyone: false },
  tags: [],
  priority: 'normal',
});
expectAssignable<PushMessage>({
  channel: 'push',
  to: { endpoint: 'https://push.example.com/1', keys: { p256dh: 'p', auth: 'a' } },
  title: 'Hi',
  tags: [],
  priority: 'normal',
});
expectError<PushMessage>({ channel: 'push', to: 'token', tags: [], priority: 'normal' });
expectAssignable<Channel>('google-chat');
expectError<Channel>('googleChat');
const anyMessage = {} as AnyMessage;
if (anyMessage.channel === 'sms') expectType<SmsMessage>(anyMessage);
else if (anyMessage.channel === 'email') expectType<Message>(anyMessage);
expectAssignable<AnyMessage>(sms);
expectAssignable<ChannelMessage>(sms);
expectError<ChannelMessage>(message);

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
  expectType<'accepted' | 'sent' | undefined>(receipt.state);
  expectType<number | undefined>(receipt.segments);
  expectType<Channel | undefined>(receipt.channel);
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
  deliveryUnknownReason: 'lost-answer',
});
if (!unknownDelivery.successful) {
  expectType<boolean | undefined>(unknownDelivery.deliveryUnknown);
  expectType<DeliveryUnknownReason | undefined>(unknownDelivery.deliveryUnknownReason);
}
expectError(createFailedReceipt('Gone', { deliveryUnknown: true, deliveryUnknownReason: 'rays' }));
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
// The categories of the channels, and the parts of an SMS on its receipt.
const optedOut = createFailedReceipt('The number opted out.', {
  provider: 'twilio',
  category: 'opted-out',
  channel: 'sms',
  segments: 2,
});
if (!optedOut.successful) expectType<number | undefined>(optedOut.segments);
for (const category of [
  'invalid-recipient',
  'opted-out',
  'outside-window',
  'blocked',
  'not-on-channel',
  'unregistered',
  'unreachable',
] as const) {
  expectAssignable<ReceiptErrorCategory>(category);
}
expectError<ReceiptErrorCategory>('opted_out');

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
expectError(transport.send(sms));

// A transport of a channel takes the messages of its channel alone.
declare const twilio: Transport<'twilio', SmsMessage>;
expectType<Promise<Receipt<'twilio'>>>(twilio.send(sms));
expectError(twilio.send(message));
if (isVerifiableTransport(twilio)) {
  expectType<VerifiableTransport<'twilio', SmsMessage>>(twilio);
}
declare const router: Transport<'router', AnyMessage>;
expectType<Promise<Receipt<'router'>>>(router.send(sms));
expectType<Promise<Receipt<'router'>>>(router.send(message));

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
expectType<Channel>(event.channel);
expectType<DeliveryEventType>(event.type);
expectType<'hard' | 'soft' | 'undetermined' | undefined>(event.bounce?.kind);
expectType<readonly string[]>(event.tags);
expectAssignable<DeliveryBounce>({ kind: 'hard', code: '5.1.1' });
expectType<{ readonly category: ReceiptErrorCategory; readonly code: string } | undefined>(
  event.error,
);
for (const type of ['sent', 'read', 'failed', 'expired', 'subscribed'] as const) {
  expectAssignable<DeliveryEventType>(type);
}
expectError<DeliveryEventType>('opted_out');

// The contracts of the reliability layer are types of the root.
import type {
  AuditEvent as RootAuditEvent,
  AuditSink as RootAuditSink,
  JsonObject as RootJsonObject,
  MessageState as RootMessageState,
  QueueDriver as RootQueueDriver,
  QueueOutcome as RootQueueOutcome,
  QueueSource as RootQueueSource,
} from '../../index.js';
const reliabilityState: RootMessageState = 'delivery_unknown';
for (const state of ['sent', 'read', 'expired'] as const) {
  expectAssignable<RootMessageState>(state);
}
expectError<RootMessageState>('lost');
expectAssignable<Channel | undefined>(({} as RootAuditEvent).channel);
const reliabilityOutcome: RootQueueOutcome = {
  type: 'retry',
  delayMilliseconds: 1,
  code: 'c',
  reason: 'r',
};
expectError<RootQueueOutcome>({ type: 'retry' });
const reliabilitySink: RootAuditSink = {
  append: (event: RootAuditEvent) => void event.correlationId,
};
const reliabilityJson: RootJsonObject = { a: [1, 'b', null, { c: true }] };
declare const reliabilityDriver: RootQueueDriver;
declare const reliabilitySource: RootQueueSource;
expectType<string>(reliabilityDriver.id);
expectType<string>(reliabilitySource.id);
void [reliabilityState, reliabilityOutcome, reliabilitySink, reliabilityJson];
