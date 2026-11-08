import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SmsMessage, WhatsAppMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { AwsSmsTransport } from '../../src/aws-sms/index.js';

const sms = new AwsSmsTransport({
  credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
  region: 'eu-west-1',
  messageType: 'TRANSACTIONAL',
});
new AwsSmsTransport({
  credentials: async () => ({ accessKeyId: 'a', secretAccessKey: 'b', sessionToken: 'c' }),
});
expectError(new AwsSmsTransport({}));
expectError(
  new AwsSmsTransport({
    credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
    messageType: 'OTP',
  }),
);
expectType<'aws-sms'>(sms.id);
expectType<Promise<Receipt<'aws-sms'>>>(
  sms.send(createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Hi' })),
);
expectAssignable<Transport<'aws-sms', SmsMessage>>(sms);
declare const whatsapp: WhatsAppMessage;
expectError(sms.send(whatsapp));
