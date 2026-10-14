import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import {
  ResendTransport,
  type ResendApiError,
  type ResendConfig,
  type ResolvedResendConfig,
} from '../../src/resend/index.js';

const transport = new ResendTransport({ apiKey: 're_123', timeout: 10_000, retries: 1 });
expectAssignable<Transport<'resend'>>(transport);
expectType<ResolvedResendConfig>(transport.config);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { html: '<p>Hi</p>' },
});
expectType<Promise<Receipt<'resend'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'resend'>>>(transport.sendMany([message]));

expectAssignable<ResendConfig>({ apiKey: 're_123', baseUrl: 'https://api.resend.com' });
declare const error: ResendApiError;
expectType<number | undefined>(error.statusCode);
expectError(new ResendTransport({}));
