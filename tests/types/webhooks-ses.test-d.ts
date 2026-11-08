import { expectAssignable, expectError, expectType } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createMemoryReplayStore, type ReplayStore } from '../../src/webhooks/index.js';
import { createSesWebhookVerifier, type SesWebhookResult } from '../../src/webhooks/ses/index.js';

const store: ReplayStore = createMemoryReplayStore({ maxEntries: 100, now: Date.now });
const shared: ReplayStore = {
  reserve: async () => 'reserved' as const,
  commit: async () => {},
  release: async () => {},
};
const ses = createSesWebhookVerifier({
  topicArns: ['arn:aws:sns:eu-west-1:1:ses'],
  fetch: globalThis.fetch,
  toleranceMs: 60_000,
  replayStore: store,
  maxBodyBytes: 1024,
});
createSesWebhookVerifier({ topicArns: ['arn'], replayStore: null });
const result = await ses.verify({ body: '{}', headers: new Headers() });
expectType<SesWebhookResult>(result);
expectAssignable<readonly DeliveryEvent<'ses'>[]>(result.events);
expectType<string | undefined>(result.confirmation?.subscribeUrl);
await ses.verify({ body: new Uint8Array(), headers: { 'x-amz-sns-message-type': 'Notification' } });
expectError(ses.verify({ body: {} }));
expectError(createSesWebhookVerifier({}));
expectType<Promise<void>>(result.commit());
expectType<Promise<void>>(result.commit([result.events[0]]));
expectType<Promise<void>>(result.release());
createSesWebhookVerifier({ topicArns: ['arn'], replayStore: shared, leaseMs: 10_000 });
expectError(createSesWebhookVerifier({ topicArns: ['arn'] }));
createSesWebhookVerifier({
  topicArns: ['arn'],
  replayStore: null,
  signatureVersions: ['2'],
  certificateTimeoutMs: 5000,
});
expectError(
  createSesWebhookVerifier({ topicArns: ['arn'], replayStore: null, signatureVersions: ['3'] }),
);
