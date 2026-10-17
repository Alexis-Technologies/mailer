import { expectNotAssignable, expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import {
  SendGridApiError,
  SendGridTransport,
  type SendGridConfig,
} from '../../src/sendgrid/index.js';

const transport = new SendGridTransport({ apiKey: 'SG.key', clickTracking: false });
expectAssignable<Transport<'sendgrid'>>(transport);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'sendgrid'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'sendgrid'>>>(transport.sendMany([message]));

expectAssignable<SendGridConfig>({ apiKey: 'SG.key', timeout: 5000, retries: 2 });
// sendMany() sends as many messages at once.
expectAssignable<SendGridConfig>({ apiKey: 'SG.key', timeout: 5000, retries: 2, concurrency: 4 });
expectNotAssignable<SendGridConfig>({
  apiKey: 'SG.key',
  timeout: 5000,
  retries: 2,
  concurrency: '4',
});
expectAssignable<Error>(new SendGridApiError('Bad request', 400));
expectError(new SendGridTransport({ retries: 1 }));
