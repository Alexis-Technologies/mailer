import { expectAssignable, expectError, expectType } from 'tsd';
import type { PushMessage, Receipt, SmsMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { ApnsTransport } from '../../src/apns/index.js';

const apns = new ApnsTransport({
  teamId: 'TEAM123456',
  keyId: 'KEY1234567',
  privateKey: '-----BEGIN PRIVATE KEY-----',
  topic: 'com.example.app',
  environment: 'production',
});
expectError(
  new ApnsTransport({ teamId: 'T', keyId: 'K', privateKey: 'p', topic: 't', environment: 'dev' }),
);
expectError(new ApnsTransport({ teamId: 'T', keyId: 'K', privateKey: 'p', topic: 't' }));
expectType<'apns'>(apns.id);
const message = createChannelMessage({
  channel: 'push',
  to: { token: 'a1b2' },
  title: 'Hi',
  payload: { headers: { 'apns-collapse-id': 'x' }, payload: { aps: { sound: 'default' } } },
});
expectType<Promise<Receipt<'apns'>>>(apns.send(message));
expectType<Promise<void>>(apns[Symbol.asyncDispose]());
expectAssignable<Transport<'apns', PushMessage>>(apns);
declare const sms: SmsMessage;
expectError(apns.send(sms));
