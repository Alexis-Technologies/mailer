import { expectAssignable, expectError, expectType } from 'tsd';
import type { RcsMessage, Receipt, SmsMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { RbmTransport, type GoogleServiceAccount } from '../../src/rbm/index.js';

declare const serviceAccount: GoogleServiceAccount;
const rbm = new RbmTransport({ serviceAccount, agentId: 'agent', region: 'europe' });
expectError(new RbmTransport({ serviceAccount }));
expectError(new RbmTransport({ serviceAccount, agentId: 'a', region: 'us' }));
expectType<'rbm'>(rbm.id);
expectType<Promise<Receipt<'rbm'>>>(
  rbm.send(createChannelMessage({ channel: 'rcs', to: '+380671234567', text: 'Hi' })),
);
expectAssignable<Transport<'rbm', RcsMessage>>(rbm);
declare const sms: SmsMessage;
expectError(rbm.send(sms));
