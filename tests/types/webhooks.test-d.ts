import { expectError, expectType } from 'tsd';
import {
  WebhookVerificationError,
  createAzureWebhookVerifier,
  createMemoryReplayStore,
  createScalewayWebhookVerifier,
  createSmtp2goWebhookVerifier,
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

const scaleway = createScalewayWebhookVerifier({
  topicArns: ['arn:scw:sns:fr-par:p:t'],
  trustChain: '-----BEGIN CERTIFICATE-----',
  replayStore: store,
});
expectType<string | undefined>((await scaleway.verify({ body: '' })).confirmation?.token);
createSmtp2goWebhookVerifier({ username: 'u', password: 'p' });
const azure = createAzureWebhookVerifier({
  token: 't',
  header: 'x-webhook-token',
  replayStore: store,
});
expectType<string | undefined>((await azure.verify({ body: '' })).validation?.validationCode);
expectError(createScalewayWebhookVerifier({ topicArns: ['arn'] }));
expectError(createAzureWebhookVerifier({}));
