import { expectAssignable, expectError } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createBrevoWebhookVerifier } from '../../src/webhooks/brevo/index.js';

createBrevoWebhookVerifier({ token: 't', header: 'x-webhook-token' });
expectError(createBrevoWebhookVerifier({}));
expectAssignable<readonly DeliveryEvent<'brevo'>[]>(
  (await createBrevoWebhookVerifier({ token: 't' }).verify({ body: '' })).events,
);
