import { expectNotAssignable, expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import {
  MailerooApiError,
  MailerooTimeoutError,
  MailerooTransport,
  createMailerooConfig,
  type MailerooConfig,
  type ResolvedMailerooConfig,
} from '../../src/maileroo/index.js';

const transport = new MailerooTransport({ apiKey: 'key', timeout: 5000 });
expectAssignable<Transport<'maileroo'>>(transport);
expectType<ResolvedMailerooConfig>(createMailerooConfig({ apiKey: 'key' }));

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'maileroo'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'maileroo'>>>(transport.sendMany([message]));

expectAssignable<MailerooConfig>({ apiKey: 'key', tracking: false, retries: 1 });
// sendMany() sends as many messages at once.
expectAssignable<MailerooConfig>({ apiKey: 'key', tracking: false, retries: 1, concurrency: 4 });
expectNotAssignable<MailerooConfig>({
  apiKey: 'key',
  tracking: false,
  retries: 1,
  concurrency: '4',
});
expectAssignable<Error>(new MailerooApiError('Unauthorized', 401));
expectAssignable<Error>(new MailerooTimeoutError(1000));
expectError(new MailerooTransport({ timeout: 5000 }));
