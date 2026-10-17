import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createMessage,
  type RawTransport,
  type Receipt,
  type Transport,
  type VerifiableTransport,
} from '../../index.js';
import {
  IdempotencyTransport,
  createMemoryIdempotencyStore,
  type IdempotencyRecord,
  type IdempotencyStore,
} from '../../src/idempotency/index.js';

declare const inner: Transport<'resend'>;
const store: IdempotencyStore = createMemoryIdempotencyStore({ maxEntries: 10, now: Date.now });
const custom: IdempotencyStore = {
  reserve: async (_key, fingerprint): Promise<IdempotencyRecord | undefined> =>
    fingerprint === '' ? undefined : { state: 'pending', fingerprint },
  complete: async () => {},
  release: () => {},
};
const once = new IdempotencyTransport(inner, {
  store: custom,
  ttlMs: 60_000,
  key: (message) => ('idempotencyKey' in message ? message.idempotencyKey : undefined),
  namespace: 'tenant-a',
});
new IdempotencyTransport(inner, { store });
new IdempotencyTransport(inner);
expectType<'resend'>(once.id);
expectAssignable<RawTransport<'resend'>>(once);
expectAssignable<VerifiableTransport<'resend'>>(once);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
  idempotencyKey: 'k',
});
expectType<Promise<Receipt<'resend'>>>(once.send(message));
expectType<AsyncIterable<Receipt<'resend'>>>(once.sendMany([message]));
expectError(new IdempotencyTransport(inner, { store: {} }));
