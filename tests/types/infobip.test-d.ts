import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SmsMessage, TelegramMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { InfobipTransport } from '../../src/infobip/index.js';

const infobip = new InfobipTransport({
  apiKey: 'k',
  baseUrl: 'xyz.api.infobip.com',
  from: 'Brand',
});
expectError(new InfobipTransport({ apiKey: 'k' }));
expectType<'infobip'>(infobip.id);
expectType<Promise<Receipt<'infobip'>>>(
  infobip.send(createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Hi' })),
);
expectAssignable<Transport<'infobip', SmsMessage>>(infobip);
declare const telegram: TelegramMessage;
expectError(infobip.send(telegram));
