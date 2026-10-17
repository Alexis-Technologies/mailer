import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type VerifiableTransport } from '../../index.js';
import { MailjetTransport } from '../../src/mailjet/index.js';

const transport = new MailjetTransport({
  apiKey: 'public',
  apiSecret: 'private',
  sandbox: true,
  openTracking: true,
});
expectType<'mailjet'>(transport.id);
expectAssignable<VerifiableTransport<'mailjet'>>(transport);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'mailjet'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'mailjet'>>>(transport.sendMany([message]));
expectType<Promise<void>>(transport.verify());
expectError(new MailjetTransport({ apiKey: 'public' }));
