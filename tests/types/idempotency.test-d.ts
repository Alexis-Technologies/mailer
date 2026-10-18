import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
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
  type IdempotencyReservation,
  type IdempotencyStore,
} from '../../src/idempotency/index.js';

declare const inner: Transport<'resend'>;
const store: IdempotencyStore = createMemoryIdempotencyStore({ maxEntries: 10, now: Date.now });
const custom: IdempotencyStore = {
  reserve: async (_key, fingerprint, leaseMs): Promise<IdempotencyReservation> =>
    leaseMs > 0 ? { token: 't' } : { record: { state: 'pending', fingerprint } },
  complete: async (_key, token, record, ttlMs) => {
    expectType<string>(token);
    expectType<Receipt>(record.receipt);
    expectType<number>(ttlMs);
  },
  release: (_key, token) => {
    expectType<string>(token);
  },
};
const once = new IdempotencyTransport(inner, {
  store: custom,
  leaseMs: 30_000,
  ttlMs: 60_000,
  key: (message) => ('idempotencyKey' in message ? message.idempotencyKey : undefined),
  namespace: 'tenant-a',
});
new IdempotencyTransport(inner, { store });
new IdempotencyTransport(inner);
expectType<number>(once.config.leaseMs);
expectType<number>(once.config.ttlMs);
expectType<'resend'>(once.id);
expectAssignable<RawTransport<'resend'>>(once);
expectAssignable<VerifiableTransport<'resend'>>(once);

declare const reservation: IdempotencyReservation;
if (reservation.token === undefined) expectType<IdempotencyRecord>(reservation.record);
else expectType<string>(reservation.token);
expectNotAssignable<IdempotencyReservation>({});
expectNotAssignable<IdempotencyReservation>(undefined);
expectNotAssignable<IdempotencyReservation>({
  token: 't',
  record: { state: 'done', fingerprint: 'f' },
});

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
// A store of the earlier contract, which answered a free key with `undefined`.
expectError<IdempotencyStore>({
  reserve: async () => undefined,
  complete: async () => {},
  release: () => {},
});
// A pino-like logger.
new IdempotencyTransport(inner, { logger: { info() {}, debug() {}, warn() {} } });
expectError(new IdempotencyTransport(inner, { logger: 'pino' }));
