import { expectError, expectType } from 'tsd';
import {
  WebhookVerificationError,
  createMemoryReplayStore,
  type ReplayState,
  type ReplayStore,
  type WebhookVerificationReason,
} from '../../src/webhooks/index.js';

const store: ReplayStore = createMemoryReplayStore({ maxEntries: 100, now: Date.now });
const error = new WebhookVerificationError('replay', 'seen');
expectType<WebhookVerificationReason>(error.reason);
expectType<number>(error.status);
new WebhookVerificationError('pending', 'held', { status: 503, cause: error });
expectType<ReplayState | Promise<ReplayState>>(store.reserve('id', 30_000));
expectType<ReplayState | Promise<ReplayState>>(store.reserve('id', 30_000, 'token'));
expectType<void | Promise<void>>(store.commit('id', 60_000, 'token'));
expectType<void | Promise<void>>(store.release('id', 'token'));
const shared: ReplayStore = {
  reserve: async () => 'reserved' as const,
  commit: async () => {},
  release: async () => {},
};
expectError<ReplayStore>({ add: () => true });
