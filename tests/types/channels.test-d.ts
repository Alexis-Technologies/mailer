import { expectAssignable, expectError, expectType } from 'tsd';
import type {
  ChannelMessage,
  E164,
  PushMessage,
  SlackMessage,
  SmsMessage,
  TelegramMessage,
  WhatsAppMessage,
} from '../../index.js';
import {
  checkChannelMessage,
  countSegments,
  createChannelMessage,
  escapeDiscordMarkdown,
  escapeSlackText,
  escapeTelegramHtml,
  isChannelMessage,
  isE164,
  neutralizeMentions,
  normalizePhone,
  type ChannelMessageConstructor,
  type SmsSegments,
} from '../../src/channels/index.js';

// The message of a channel is the type of its channel.
const sms = createChannelMessage(
  { channel: 'sms', to: '067 123 45 67', text: 'Your code is 1234', priority: 'high' },
  { defaultCountry: 'UA' },
);
expectType<SmsMessage>(sms);
expectType<E164>(sms.to);
expectType<TelegramMessage>(createChannelMessage({ channel: 'telegram', to: 42, text: 'Hi' }));
expectType<WhatsAppMessage>(
  createChannelMessage({
    channel: 'whatsapp',
    to: '+380671234567',
    template: { name: 'otp', language: 'uk', components: [{ type: 'body' }] },
  }),
);
expectType<SlackMessage>(
  createChannelMessage({ channel: 'slack', text: 'Deployed', tags: 'deploys', thread: '1.2' }),
);
expectType<PushMessage>(
  createChannelMessage({ channel: 'push', to: { token: 't' }, title: 'Hi', data: { a: '1' } }),
);
// Fields of another channel, an email and an unknown channel are refused.
expectError(createChannelMessage({ channel: 'sms', to: '+380671234567', template: {} }));
expectError(createChannelMessage({ channel: 'email', to: 'a@example.com' }));
expectError(createChannelMessage({ channel: 'fax', to: '+380671234567' }));
expectError(createChannelMessage({ channel: 'push', to: 'token', title: 'Hi' }));
expectAssignable<ChannelMessageConstructor>({ channel: 'viber', to: 'id', text: 'x' });

checkChannelMessage(sms);
expectError(checkChannelMessage({ channel: 'sms', to: '+380671234567' }));
declare const value: unknown;
if (isChannelMessage(value)) expectType<ChannelMessage>(value);

// Phones, segments and markup.
expectType<E164 | undefined>(normalizePhone('+44 20 7946 0018'));
expectType<E164 | undefined>(normalizePhone('020 7946 0018', { defaultCountry: 'GB' }));
if (isE164(value)) expectType<E164>(value);
const segments = countSegments('Привіт');
expectType<SmsSegments>(segments);
expectType<'GSM-7' | 'UCS-2'>(segments.encoding);
expectType<number>(segments.segments);
expectType<string>(escapeTelegramHtml('<b>'));
expectType<string>(escapeSlackText('<!channel>'));
expectType<string>(escapeDiscordMarkdown('*'));
expectType<string>(neutralizeMentions('@everyone'));
