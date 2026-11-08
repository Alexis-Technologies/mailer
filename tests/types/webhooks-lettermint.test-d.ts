import { expectAssignable } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createLettermintWebhookVerifier } from '../../src/webhooks/lettermint/index.js';

createLettermintWebhookVerifier({ secret: 'whsec_x', toleranceMs: 60_000, replayStore: null });
expectAssignable<readonly DeliveryEvent<'lettermint'>[]>(
  (
    await createLettermintWebhookVerifier({ secret: 'whsec_x', replayStore: null }).verify({
      body: '',
    })
  ).events,
);
