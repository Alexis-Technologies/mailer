import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type VerifiableTransport } from '../../index.js';
import { MailerSendTransport } from '../../src/mailersend/index.js';

const transport = new MailerSendTransport({
  apiKey: 'mlsn.key',
  openTracking: true,
  precedenceBulk: false,
  concurrency: 2,
  now: () => Date.now(),
});
expectType<'mailersend'>(transport.id);
expectAssignable<VerifiableTransport<'mailersend'>>(transport);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'mailersend'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'mailersend'>>>(transport.sendMany([message]));
expectType<Promise<void>>(transport.verify());
expectError(new MailerSendTransport({}));
