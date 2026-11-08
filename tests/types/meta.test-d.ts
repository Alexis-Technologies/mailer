import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SmsMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { MetaTransport, type MetaMessage } from '../../src/meta/index.js';

const meta = new MetaTransport({
  accessToken: 'token',
  whatsapp: { phoneNumberId: '1' },
  messenger: { pageId: '2', accessToken: 'page' },
  instagram: { accountId: '3' },
  graphVersion: 'v24.0',
});
expectType<'meta'>(meta.id);
const whatsapp = createChannelMessage({
  channel: 'whatsapp',
  to: '+380671234567',
  template: { name: 'otp', language: 'uk' },
});
expectType<Promise<Receipt<'meta'>>>(meta.send(whatsapp));
meta.send(createChannelMessage({ channel: 'messenger', to: '1', text: 'Hi' }));
meta.send(createChannelMessage({ channel: 'instagram', to: '1', text: 'Hi' }));
expectType<Promise<void>>(meta.verify());
expectAssignable<Transport<'meta', MetaMessage>>(meta);
declare const sms: SmsMessage;
expectError(meta.send(sms));
