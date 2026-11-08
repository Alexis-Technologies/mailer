import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SmsMessage, TelegramMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { VonageTransport } from '../../src/vonage/index.js';

const vonage = new VonageTransport({ apiKey: 'k', apiSecret: 's', from: 'Brand' });
expectError(new VonageTransport({ apiKey: 'k' }));
expectType<'vonage'>(vonage.id);
expectType<Promise<Receipt<'vonage'>>>(
  vonage.send(createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Hi' })),
);
expectAssignable<Transport<'vonage', SmsMessage>>(vonage);
declare const telegram: TelegramMessage;
expectError(vonage.send(telegram));
