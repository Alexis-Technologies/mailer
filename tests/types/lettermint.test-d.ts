import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import {
  LettermintApiError,
  LettermintTimeoutError,
  LettermintTransport,
  createLettermintConfig,
  type LettermintConfig,
  type ResolvedLettermintConfig,
} from '../../src/lettermint/index.js';

const transport = new LettermintTransport({ apiToken: 'token', route: 'outgoing' });
expectAssignable<Transport<'lettermint'>>(transport);
expectType<ResolvedLettermintConfig>(createLettermintConfig({ apiToken: 'token' }));

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'lettermint'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'lettermint'>>>(transport.sendMany([message]));

expectAssignable<LettermintConfig>({ apiToken: 'token', tag: null, metadata: { app: 'x' } });
expectAssignable<Error>(new LettermintApiError('Unauthorized', 401));
expectAssignable<Error>(new LettermintTimeoutError(1000));
expectError(new LettermintTransport({ route: 'outgoing' }));
