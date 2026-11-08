import { expectAssignable } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createSparkPostWebhookVerifier } from '../../src/webhooks/sparkpost/index.js';

const sparkpost = createSparkPostWebhookVerifier({ username: 'u', password: 'p' });
expectAssignable<readonly DeliveryEvent<'sparkpost'>[]>(
  (await sparkpost.verify({ body: '' })).events,
);
