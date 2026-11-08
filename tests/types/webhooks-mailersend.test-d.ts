import { expectAssignable } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createMailerSendWebhookVerifier } from '../../src/webhooks/mailersend/index.js';

const mailersend = createMailerSendWebhookVerifier({ secret: 's', replayStore: null });
expectAssignable<readonly DeliveryEvent<'mailersend'>[]>(
  (await mailersend.verify({ body: '' })).events,
);
