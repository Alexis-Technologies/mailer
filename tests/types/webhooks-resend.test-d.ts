import { expectAssignable, expectError } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createMemoryReplayStore, type ReplayStore } from '../../src/webhooks/index.js';
import { createResendWebhookVerifier } from '../../src/webhooks/resend/index.js';

const store: ReplayStore = createMemoryReplayStore({ maxEntries: 100, now: Date.now });
const resend = createResendWebhookVerifier({
  secret: 'whsec_abc=',
  toleranceMs: 1000,
  replayStore: store,
});
expectAssignable<readonly DeliveryEvent<'resend'>[]>((await resend.verify({ body: '' })).events);
expectError(createResendWebhookVerifier({}));
