import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import { ZeptoMailTransport } from '../../src/zeptomail/index.js';

const transport = new ZeptoMailTransport({
  token: 'zm-token',
  baseUrl: 'https://api.zeptomail.eu',
  bounceAddress: 'bounce@bounces.example.com',
  clientReference: 'ref',
  clickTracking: true,
  concurrency: 2,
});
expectType<'zeptomail'>(transport.id);
expectAssignable<Transport<'zeptomail'>>(transport);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'zeptomail'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'zeptomail'>>>(transport.sendMany([message]));
expectError(transport.verify());
expectError(new ZeptoMailTransport({}));
