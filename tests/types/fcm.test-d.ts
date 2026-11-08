import { expectAssignable, expectError, expectType } from 'tsd';
import type { PushMessage, Receipt, SmsMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { FcmTransport, type GoogleServiceAccount } from '../../src/fcm/index.js';

declare const serviceAccount: GoogleServiceAccount;
const fcm = new FcmTransport({ serviceAccount, projectId: 'app-1', retries: 1, now: Date.now });
expectError(new FcmTransport({}));
expectType<'fcm'>(fcm.id);
const message = createChannelMessage({
  channel: 'push',
  to: { token: 'device' },
  title: 'Hi',
  data: { order: '1' },
});
expectType<Promise<Receipt<'fcm'>>>(fcm.send(message));
expectType<Promise<void>>(fcm.verify());
expectAssignable<Transport<'fcm', PushMessage>>(fcm);
declare const sms: SmsMessage;
expectError(fcm.send(sms));
