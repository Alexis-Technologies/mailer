import { expectAssignable, expectError, expectType } from 'tsd';
import type { PushMessage, Receipt, SmsMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { WebPushTransport, type VapidKeys } from '../../src/webpush/index.js';

declare const vapid: VapidKeys;
const webpush = new WebPushTransport({
  vapid,
  ttl: 3600,
  allowEndpoint: (url) => url.protocol === 'https:',
  retries: 1,
});
expectError(new WebPushTransport({}));
expectType<'webpush'>(webpush.id);
const message = createChannelMessage({
  channel: 'push',
  to: { endpoint: 'https://push.example.com/x', keys: { p256dh: 'a', auth: 'b' } },
  title: 'Hi',
});
expectType<Promise<Receipt<'webpush'>>>(webpush.send(message));
expectAssignable<Transport<'webpush', PushMessage>>(webpush);
declare const sms: SmsMessage;
expectError(webpush.send(sms));
