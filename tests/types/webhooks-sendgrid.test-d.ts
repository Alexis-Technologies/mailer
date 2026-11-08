import { expectAssignable } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createMemoryReplayStore, type ReplayStore } from '../../src/webhooks/index.js';
import { createSendGridWebhookVerifier } from '../../src/webhooks/sendgrid/index.js';

const store: ReplayStore = createMemoryReplayStore({ maxEntries: 100, now: Date.now });
const sendgrid = createSendGridWebhookVerifier({ publicKey: 'MFkw…', replayStore: store });
expectAssignable<readonly DeliveryEvent<'sendgrid'>[]>(
  (await sendgrid.verify({ body: '' })).events,
);
