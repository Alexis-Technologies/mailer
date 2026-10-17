import { expectNotAssignable, expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import { MailgunApiError, MailgunTransport, type MailgunConfig } from '../../src/mailgun/index.js';

const transport = new MailgunTransport({ apiKey: 'key', domain: 'mg.example.com', region: 'eu' });
expectAssignable<Transport<'mailgun'>>(transport);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'mailgun'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'mailgun'>>>(transport.sendMany([message]));

expectAssignable<MailgunConfig>({ apiKey: 'key', domain: 'mg.example.com', tracking: true });
// sendMany() sends as many messages at once.
expectAssignable<MailgunConfig>({
  apiKey: 'key',
  domain: 'mg.example.com',
  tracking: true,
  concurrency: 4,
});
expectNotAssignable<MailgunConfig>({
  apiKey: 'key',
  domain: 'mg.example.com',
  tracking: true,
  concurrency: '4',
});
expectAssignable<Error>(new MailgunApiError('Forbidden', 403));
expectError(new MailgunTransport({ apiKey: 'key' }));
expectError(new MailgunTransport({ apiKey: 'key', domain: 'mg.example.com', region: 'ap' }));
