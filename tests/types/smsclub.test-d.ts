import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SmsMessage, TelegramMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { SmsClubTransport } from '../../src/smsclub/index.js';

const smsclub = new SmsClubTransport({ token: 't', sender: 'Brand' });
expectError(new SmsClubTransport({ sender: 'Brand' }));
expectType<'smsclub'>(smsclub.id);
expectType<Promise<Receipt<'smsclub'>>>(
  smsclub.send(createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Hi' })),
);
expectAssignable<Transport<'smsclub', SmsMessage>>(smsclub);
declare const telegram: TelegramMessage;
expectError(smsclub.send(telegram));
