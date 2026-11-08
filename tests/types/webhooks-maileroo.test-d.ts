import { expectAssignable } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createMemoryReplayStore, type ReplayStore } from '../../src/webhooks/index.js';
import { createMailerooWebhookVerifier } from '../../src/webhooks/maileroo/index.js';

const store: ReplayStore = createMemoryReplayStore({ maxEntries: 100, now: Date.now });
createMailerooWebhookVerifier({ secret: 's', replayStore: store });
expectAssignable<readonly DeliveryEvent<'maileroo'>[]>(
  (await createMailerooWebhookVerifier({ secret: 's', replayStore: null }).verify({ body: '' }))
    .events,
);
