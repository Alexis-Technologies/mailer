import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type VerifiableTransport } from '../../index.js';
import { Smtp2goTransport } from '../../src/smtp2go/index.js';

const transport = new Smtp2goTransport({
  apiKey: 'api-key',
  region: 'au',
  fastAccept: true,
  concurrency: 2,
  now: () => Date.now(),
});
expectType<'smtp2go'>(transport.id);
expectAssignable<VerifiableTransport<'smtp2go'>>(transport);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'smtp2go'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'smtp2go'>>>(transport.sendMany([message]));
expectType<Promise<void>>(transport.verify());
expectError(new Smtp2goTransport({}));
expectError(new Smtp2goTransport({ apiKey: 'k', region: 'asia' }));
