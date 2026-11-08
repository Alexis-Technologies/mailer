import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SmsMessage, TelegramMessage, Transport, ViberMessage } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { AlphaSmsTransport } from '../../src/alphasms/index.js';

const alphasms = new AlphaSmsTransport({ apiKey: 'k', sender: 'Brand', generateId: () => 1 });
expectError(new AlphaSmsTransport({ apiKey: 'k', generateId: () => 'x' }));
expectType<'alphasms'>(alphasms.id);
expectType<Promise<Receipt<'alphasms'>>>(
  alphasms.send(createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Hi' })),
);
expectType<Promise<Receipt<'alphasms'>>>(
  alphasms.send(createChannelMessage({ channel: 'viber', to: '+380671234567', text: 'Hi' })),
);
expectAssignable<Transport<'alphasms', SmsMessage | ViberMessage>>(alphasms);
declare const telegram: TelegramMessage;
expectError(alphasms.send(telegram));
