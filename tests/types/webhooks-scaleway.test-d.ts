import { expectAssignable, expectError, expectType } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createMemoryReplayStore, type ReplayStore } from '../../src/webhooks/index.js';
import { createScalewayWebhookVerifier } from '../../src/webhooks/scaleway/index.js';

const store: ReplayStore = createMemoryReplayStore({ maxEntries: 100, now: Date.now });
const scaleway = createScalewayWebhookVerifier({
  topicArns: ['arn:scw:sns:fr-par:p:t'],
  trustChain: '-----BEGIN CERTIFICATE-----',
  replayStore: store,
});
expectType<string | undefined>((await scaleway.verify({ body: '' })).confirmation?.token);
expectError(createScalewayWebhookVerifier({ topicArns: ['arn'] }));
expectAssignable<readonly DeliveryEvent<'scaleway'>[]>(
  (await scaleway.verify({ body: '' })).events,
);
