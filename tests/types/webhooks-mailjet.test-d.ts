import { expectAssignable } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createMailjetWebhookVerifier } from '../../src/webhooks/mailjet/index.js';

createMailjetWebhookVerifier({ username: 'u', password: 'p' });
expectAssignable<readonly DeliveryEvent<'mailjet'>[]>(
  (await createMailjetWebhookVerifier({ username: 'u', password: 'p' }).verify({ body: '' }))
    .events,
);
