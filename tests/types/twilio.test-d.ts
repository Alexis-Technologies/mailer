import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, TelegramMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { TwilioTransport, type TwilioMessage } from '../../src/twilio/index.js';

const twilio = new TwilioTransport({
  accountSid: 'AC1',
  authToken: 't',
  region: 'ie1',
  from: '+1',
});
new TwilioTransport({ accountSid: 'AC1', apiKey: { sid: 'SK1', secret: 's' } });
expectError(new TwilioTransport({ accountSid: 'AC1' }));
expectError(new TwilioTransport({ accountSid: 'AC1', authToken: 't', region: 'us2' }));
expectType<'twilio'>(twilio.id);
expectType<Promise<Receipt<'twilio'>>>(
  twilio.send(createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Hi' })),
);
twilio.send(createChannelMessage({ channel: 'whatsapp', to: '+380671234567', text: 'Hi' }));
twilio.send(createChannelMessage({ channel: 'rcs', to: '+380671234567', text: 'Hi' }));
expectAssignable<Transport<'twilio', TwilioMessage>>(twilio);
declare const telegram: TelegramMessage;
expectError(twilio.send(telegram));
