import { expectAssignable, expectError } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createMemoryReplayStore, type ReplayStore } from '../../src/webhooks/index.js';
import { createMailtrapWebhookVerifier } from '../../src/webhooks/mailtrap/index.js';

const store: ReplayStore = createMemoryReplayStore({ maxEntries: 100, now: Date.now });
createMailtrapWebhookVerifier({ secret: 's', maxBodyBytes: 1, replayStore: store });
expectError(createMailtrapWebhookVerifier({ secret: 's' }));
expectError(createMailtrapWebhookVerifier({ secret: 's', replayStore: null, toleranceMs: 1 }));
expectAssignable<readonly DeliveryEvent<'mailtrap'>[]>(
  (await createMailtrapWebhookVerifier({ secret: 's', replayStore: null }).verify({ body: '' }))
    .events,
);
