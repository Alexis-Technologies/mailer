import { expectAssignable } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createMailgunWebhookVerifier } from '../../src/webhooks/mailgun/index.js';

createMailgunWebhookVerifier({ signingKey: 'key', replayStore: null });
expectAssignable<readonly DeliveryEvent<'mailgun'>[]>(
  (await createMailgunWebhookVerifier({ signingKey: 'k', replayStore: null }).verify({ body: '' }))
    .events,
);
