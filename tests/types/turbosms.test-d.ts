import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SmsMessage, TelegramMessage, Transport, ViberMessage } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { TurboSmsTransport } from '../../src/turbosms/index.js';

const turbosms = new TurboSmsTransport({ token: 't', sender: 'Brand', viberSender: 'Brand' });
expectError(new TurboSmsTransport({ sender: 'Brand' }));
expectType<'turbosms'>(turbosms.id);
expectType<Promise<Receipt<'turbosms'>>>(
  turbosms.send(createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Hi' })),
);
expectType<Promise<Receipt<'turbosms'>>>(
  turbosms.send(createChannelMessage({ channel: 'viber', to: '+380671234567', text: 'Hi' })),
);
expectAssignable<Transport<'turbosms', SmsMessage | ViberMessage>>(turbosms);
declare const telegram: TelegramMessage;
expectError(turbosms.send(telegram));
