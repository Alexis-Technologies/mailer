import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import {
  MailtrapApiError,
  MailtrapTimeoutError,
  MailtrapTransport,
  createMailtrapConfig,
  type MailtrapConfig,
  type ResolvedMailtrapConfig,
} from '../../src/mailtrap/index.js';

const transport = new MailtrapTransport({ apiToken: 'token', sandbox: true, inboxId: 42 });
expectAssignable<Transport<'mailtrap'>>(transport);
expectType<ResolvedMailtrapConfig>(createMailtrapConfig({ apiToken: 'token' }));

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'mailtrap'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'mailtrap'>>>(transport.sendMany([message]));

expectAssignable<MailtrapConfig>({ apiToken: 'token', defaultCategory: 'welcome', retries: 1 });
expectAssignable<Error>(new MailtrapApiError('Unauthorized', 401));
expectAssignable<Error>(new MailtrapTimeoutError(1000));
expectError(new MailtrapTransport({ sandbox: true }));
