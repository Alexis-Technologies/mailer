import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type VerifiableTransport } from '../../index.js';
import { PostmarkTransport } from '../../src/postmark/index.js';

const transport = new PostmarkTransport({
  serverToken: 'token',
  messageStream: 'broadcast',
  openTracking: true,
  clickTracking: false,
  timeout: 10000,
  retries: 2,
  headers: { 'X-Team': 'mail' },
});
expectType<'postmark'>(transport.id);
expectAssignable<VerifiableTransport<'postmark'>>(transport);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'postmark'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'postmark'>>>(transport.sendMany([message]));
expectType<Promise<void>>(transport.verify());
expectError(new PostmarkTransport({}));
expectError(new PostmarkTransport({ serverToken: 'token', openTracking: 'yes' }));
