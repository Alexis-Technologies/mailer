import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type VerifiableTransport } from '../../index.js';
import { BrevoTransport } from '../../src/brevo/index.js';

const transport = new BrevoTransport({ apiKey: 'xkeysib-key', sandbox: true, concurrency: 3 });
expectType<'brevo'>(transport.id);
expectAssignable<VerifiableTransport<'brevo'>>(transport);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'brevo'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'brevo'>>>(transport.sendMany([message]));
expectType<Promise<void>>(transport.verify());
expectError(new BrevoTransport({}));
expectError(new BrevoTransport({ apiKey: 'k', sandbox: 'yes' }));
