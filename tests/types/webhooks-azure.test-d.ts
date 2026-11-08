import { expectAssignable, expectError, expectType } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createMemoryReplayStore, type ReplayStore } from '../../src/webhooks/index.js';
import { createAzureWebhookVerifier } from '../../src/webhooks/azure/index.js';

const store: ReplayStore = createMemoryReplayStore({ maxEntries: 100, now: Date.now });
const azure = createAzureWebhookVerifier({
  token: 't',
  header: 'x-webhook-token',
  replayStore: store,
});
expectType<string | undefined>((await azure.verify({ body: '' })).validation?.validationCode);
expectError(createAzureWebhookVerifier({}));
expectAssignable<readonly DeliveryEvent<'azure'>[]>((await azure.verify({ body: '' })).events);
