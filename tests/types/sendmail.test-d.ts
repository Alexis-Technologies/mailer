import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createMessage,
  type RawTransport,
  type Receipt,
  type VerifiableTransport,
} from '../../index.js';
import { SendmailTransport } from '../../src/sendmail/index.js';

const transport = new SendmailTransport({
  path: '/usr/sbin/sendmail',
  args: ['-oi'],
  newline: 'crlf',
  generateId: () => 'id',
});
expectType<'sendmail'>(transport.id);
expectAssignable<RawTransport<'sendmail'>>(transport);
expectAssignable<VerifiableTransport<'sendmail'>>(transport);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'sendmail'>>>(transport.send(message));
expectType<Promise<Receipt<'sendmail'>>>(
  transport.sendRaw({ envelope: { from: null, to: ['b@example.com'] }, content: new Uint8Array() }),
);
expectType<Promise<void>>(transport.verify());
new SendmailTransport();

expectError(new SendmailTransport({ newline: 'cr' }));
expectError(new SendmailTransport({ args: '-oi' }));
