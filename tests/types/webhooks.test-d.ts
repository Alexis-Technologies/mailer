import { expectAssignable, expectError, expectType } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import {
  WebhookVerificationError,
  createMailgunWebhookVerifier,
  createMemoryReplayStore,
  createPostmarkWebhookVerifier,
  createResendWebhookVerifier,
  createSendGridWebhookVerifier,
  createSesWebhookVerifier,
  type ReplayStore,
  type SesWebhookResult,
  type WebhookVerificationReason,
} from '../../src/webhooks/index.js';

const store: ReplayStore = createMemoryReplayStore({ maxEntries: 100, now: Date.now });
const ses = createSesWebhookVerifier({
  topicArns: ['arn:aws:sns:eu-west-1:1:ses'],
  fetch: globalThis.fetch,
  toleranceMs: 60_000,
  replayStore: store,
  maxBodyBytes: 1024,
});
createSesWebhookVerifier({ topicArns: ['arn'], replayStore: null });
const result = await ses.verify({ body: '{}', headers: new Headers() });
expectType<SesWebhookResult>(result);
expectAssignable<readonly DeliveryEvent<'ses'>[]>(result.events);
expectType<string | undefined>(result.confirmation?.subscribeUrl);
await ses.verify({ body: new Uint8Array(), headers: { 'x-amz-sns-message-type': 'Notification' } });
expectError(ses.verify({ body: {} }));
expectError(createSesWebhookVerifier({}));
const error = new WebhookVerificationError('replay', 'seen');
expectType<WebhookVerificationReason>(error.reason);

const resend = createResendWebhookVerifier({ secret: 'whsec_abc=', toleranceMs: 1000 });
expectAssignable<readonly DeliveryEvent<'resend'>[]>((await resend.verify({ body: '' })).events);
const sendgrid = createSendGridWebhookVerifier({ publicKey: 'MFkw…' });
expectAssignable<readonly DeliveryEvent<'sendgrid'>[]>(
  (await sendgrid.verify({ body: '' })).events,
);
createMailgunWebhookVerifier({ signingKey: 'key', replayStore: null });
const postmark = createPostmarkWebhookVerifier({ username: 'u', password: 'p' });
expectAssignable<readonly DeliveryEvent<'postmark'>[]>(
  (await postmark.verify({ body: '' })).events,
);
expectError(createPostmarkWebhookVerifier({ username: 'u' }));
expectError(createResendWebhookVerifier({}));
