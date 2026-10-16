import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createMessage,
  type RawTransport,
  type Receipt,
  type VerifiableTransport,
} from '../../index.js';
import {
  SmtpTransport,
  SmtpResponseError,
  isSmtpResponseProviderDetails,
  type DkimConfig,
  type SmtpConfig,
} from '../../src/smtp/index.js';

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  auth: { user: 'alex', pass: 'secret', method: 'login' },
  tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
});
expectAssignable<RawTransport<'smtp'>>(transport);
// cram-md5 was never implemented, and is not a method.
expectError(
  new SmtpTransport({
    host: 'smtp.example.com',
    auth: { user: 'a', pass: 'b', method: 'cram-md5' },
  }),
);
expectAssignable<VerifiableTransport<'smtp'>>(transport);
expectAssignable<AsyncDisposable>(transport);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<void>>(transport.verify());
expectAssignable<Promise<Receipt<'smtp'>>>(transport.send(message));
expectType<Promise<void>>(transport.closeAllConnections());

expectAssignable<SmtpConfig>({
  host: 'smtp.example.com',
  auth: { user: 'alex', accessToken: 'token' },
  dkim: { signatures: [] } satisfies DkimConfig,
});
expectAssignable<Error>(new SmtpResponseError('Rejected', 550, 'RCPT', 'No such user'));
expectType<boolean>(isSmtpResponseProviderDetails(undefined));

expectError(new SmtpTransport({ port: 25 }));
expectError(new SmtpTransport({ host: 'smtp.example.com', port: '25' }));

// The generator of the identifiers and the fetch of the OAuth 2.0 refresh.
expectAssignable<SmtpConfig>({
  host: 'smtp.example.com',
  generateId: (kind: string) => `01J-${kind}`,
  fetch: globalThis.fetch,
});
expectError(new SmtpTransport({ host: 'smtp.example.com', generateId: 'ulid' }));
