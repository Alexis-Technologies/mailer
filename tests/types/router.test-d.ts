import { expectAssignable, expectError, expectType } from 'tsd';
import type {
  AnyMessage,
  Message,
  Receipt,
  SmsMessage,
  TelegramMessage,
  Transport,
  VerifiableTransport,
} from '../../index.js';
import { createRouter, RouterTransport, type Routes } from '../../src/router/index.js';

declare const ses: Transport<'ses'>;
declare const twilio: Transport<'twilio', SmsMessage>;
declare const telegram: Transport<'telegram', TelegramMessage>;
declare const email: Message;
declare const sms: SmsMessage;
declare const chat: TelegramMessage;

// A router takes the messages of the channels it routes, and gives the
// receipts of their transports.
const router = createRouter({ email: ses, sms: twilio });
expectType<RouterTransport<{ email: Transport<'ses'>; sms: Transport<'twilio', SmsMessage> }>>(
  router,
);
expectType<'router'>(router.id);
expectType<Promise<Receipt<'router' | 'ses' | 'twilio'>>>(router.send(email));
expectType<Promise<Receipt<'router' | 'ses' | 'twilio'>>>(router.send(sms));
expectError(router.send(chat));
expectType<AsyncIterable<Receipt<'router' | 'ses' | 'twilio'>>>(router.sendMany([email, sms]));
expectAssignable<VerifiableTransport<string, Message | SmsMessage>>(router);
expectAssignable<AsyncDisposable>(router);

// A transport of one channel is no route of another.
expectError(createRouter({ sms: ses }));
expectError(createRouter({ telegram: twilio }));
expectError(createRouter({ fax: ses }));

// Every route given: a transport of every channel.
const all = new RouterTransport({ email: ses, sms: twilio, telegram });
expectType<Promise<Receipt<'router' | 'ses' | 'twilio' | 'telegram'>>>(all.send(chat));
declare const any: AnyMessage;
expectError(all.send(any));
expectAssignable<Routes>({ email: ses, telegram });
