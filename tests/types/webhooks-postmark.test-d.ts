import { expectAssignable, expectError, expectType } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import { createPostmarkWebhookVerifier } from '../../src/webhooks/postmark/index.js';

const postmark = createPostmarkWebhookVerifier({ username: 'u', password: 'p' });
expectAssignable<readonly DeliveryEvent<'postmark'>[]>(
  (await postmark.verify({ body: '' })).events,
);
expectError(createPostmarkWebhookVerifier({ username: 'u' }));
expectError(createPostmarkWebhookVerifier({ username: 'u', password: 'p', toleranceMs: 1 }));
createPostmarkWebhookVerifier({
  username: 'u',
  password: 'p',
  onVerify: (report) => {
    expectType<'taken' | 'refused' | 'error'>(report.status);
    expectType<number>(report.durationMs);
  },
});
