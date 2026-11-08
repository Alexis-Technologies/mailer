import { expectAssignable } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createSmtp2goWebhookVerifier } from '../../src/webhooks/smtp2go/index.js';

createSmtp2goWebhookVerifier({ username: 'u', password: 'p' });
expectAssignable<readonly DeliveryEvent<'smtp2go'>[]>(
  (await createSmtp2goWebhookVerifier({ username: 'u', password: 'p' }).verify({ body: '' }))
    .events,
);
