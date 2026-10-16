import { expectNotAssignable, expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import {
  PlunkTransport,
  type PlunkConfig,
  type PlunkResponse,
  type ResolvedPlunkConfig,
} from '../../src/plunk/index.js';

const transport = new PlunkTransport({ apiKey: 'sk_key', baseUrl: 'https://plunk.example.com' });
expectAssignable<Transport<'plunk'>>(transport);
expectType<ResolvedPlunkConfig>(transport.config);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'plunk'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'plunk'>>>(transport.sendMany([message]));

expectAssignable<PlunkConfig>({ apiKey: 'sk_key', retries: 1, timeout: 5000 });
// sendMany() sends as many messages at once.
expectAssignable<PlunkConfig>({ apiKey: 'sk_key', retries: 1, timeout: 5000, concurrency: 4 });
expectNotAssignable<PlunkConfig>({ apiKey: 'sk_key', retries: 1, timeout: 5000, concurrency: '4' });
declare const response: PlunkResponse;
expectType<boolean>(response.success);
expectError(new PlunkTransport({ baseUrl: 'https://plunk.example.com' }));
