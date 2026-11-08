import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SmsMessage, TelegramMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { createRouter } from '../../src/router/index.js';
import { TelegramTransport } from '../../src/telegram/index.js';

const telegram = new TelegramTransport({
  botToken: '123:abc',
  parseMode: 'HTML',
  baseUrl: 'http://localhost:8081',
  timeout: 10_000,
  retries: 1,
  concurrency: 2,
  fetch: globalThis.fetch,
});
expectType<'telegram'>(telegram.id);
const message = createChannelMessage({ channel: 'telegram', to: 42, text: 'Hi' });
expectType<Promise<Receipt<'telegram'>>>(telegram.send(message));
expectType<Promise<void>>(telegram.verify());
expectAssignable<Transport<'telegram', TelegramMessage>>(telegram);
createRouter({ telegram });
declare const sms: SmsMessage;
expectError(telegram.send(sms));
expectError(new TelegramTransport({}));
expectError(new TelegramTransport({ botToken: 't', parseMode: 'Markdown' }));
