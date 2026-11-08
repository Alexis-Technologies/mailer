import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SmsMessage, TelegramMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { SinchTransport } from '../../src/sinch/index.js';

const sinch = new SinchTransport({ servicePlanId: 'p', apiToken: 't', region: 'eu' });
expectError(new SinchTransport({ servicePlanId: 'p', apiToken: 't', region: 'xx' }));
expectType<'sinch'>(sinch.id);
expectType<Promise<Receipt<'sinch'>>>(
  sinch.send(createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Hi' })),
);
expectAssignable<Transport<'sinch', SmsMessage>>(sinch);
declare const telegram: TelegramMessage;
expectError(sinch.send(telegram));
