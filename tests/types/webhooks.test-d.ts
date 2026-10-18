import { expectAssignable, expectError, expectType } from 'tsd';
import type { DeliveryEvent } from '../../index.js';
import {
  WebhookVerificationError,
  createAzureWebhookVerifier,
  createBrevoWebhookVerifier,
  createLettermintWebhookVerifier,
  createMailerooWebhookVerifier,
  createMailerSendWebhookVerifier,
  createMailgunWebhookVerifier,
  createMailjetWebhookVerifier,
  createMailtrapWebhookVerifier,
  createMemoryReplayStore,
  createPostmarkWebhookVerifier,
  createResendWebhookVerifier,
  createScalewayWebhookVerifier,
  createSendGridWebhookVerifier,
  createSesWebhookVerifier,
  createSmtp2goWebhookVerifier,
  createSparkPostWebhookVerifier,
  type ReplayState,
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
expectType<number>(error.status);
new WebhookVerificationError('pending', 'held', { status: 503, cause: error });
expectType<Promise<void>>(result.commit());
expectType<Promise<void>>(result.commit([result.events[0]]));
expectType<Promise<void>>(result.release());
expectType<ReplayState | Promise<ReplayState>>(store.reserve('id', 30_000));
const shared: ReplayStore = {
  reserve: async () => 'reserved' as const,
  commit: async () => {},
  release: async () => {},
};
createSesWebhookVerifier({ topicArns: ['arn'], replayStore: shared, leaseMs: 10_000 });
expectError(createSesWebhookVerifier({ topicArns: ['arn'] }));
expectError<ReplayStore>({ add: () => true });

const resend = createResendWebhookVerifier({
  secret: 'whsec_abc=',
  toleranceMs: 1000,
  replayStore: store,
});
expectAssignable<readonly DeliveryEvent<'resend'>[]>((await resend.verify({ body: '' })).events);
const sendgrid = createSendGridWebhookVerifier({ publicKey: 'MFkw…', replayStore: store });
expectAssignable<readonly DeliveryEvent<'sendgrid'>[]>(
  (await sendgrid.verify({ body: '' })).events,
);
createMailgunWebhookVerifier({ signingKey: 'key', replayStore: null });
const postmark = createPostmarkWebhookVerifier({ username: 'u', password: 'p' });
expectAssignable<readonly DeliveryEvent<'postmark'>[]>(
  (await postmark.verify({ body: '' })).events,
);
expectError(createPostmarkWebhookVerifier({ username: 'u' }));
expectError(createPostmarkWebhookVerifier({ username: 'u', password: 'p', toleranceMs: 1 }));
expectError(createResendWebhookVerifier({}));

const mailersend = createMailerSendWebhookVerifier({ secret: 's', replayStore: null });
expectAssignable<readonly DeliveryEvent<'mailersend'>[]>(
  (await mailersend.verify({ body: '' })).events,
);
createMailtrapWebhookVerifier({ secret: 's', maxBodyBytes: 1, replayStore: store });
expectError(createMailtrapWebhookVerifier({ secret: 's' }));
createBrevoWebhookVerifier({ token: 't', header: 'x-webhook-token' });
createMailjetWebhookVerifier({ username: 'u', password: 'p' });
const sparkpost = createSparkPostWebhookVerifier({ username: 'u', password: 'p' });
expectAssignable<readonly DeliveryEvent<'sparkpost'>[]>(
  (await sparkpost.verify({ body: '' })).events,
);
expectError(createBrevoWebhookVerifier({}));
expectError(createMailtrapWebhookVerifier({ secret: 's', replayStore: null, toleranceMs: 1 }));

const scaleway = createScalewayWebhookVerifier({
  topicArns: ['arn:scw:sns:fr-par:p:t'],
  trustChain: '-----BEGIN CERTIFICATE-----',
  replayStore: store,
});
expectType<string | undefined>((await scaleway.verify({ body: '' })).confirmation?.token);
createLettermintWebhookVerifier({ secret: 'whsec_x', toleranceMs: 60_000, replayStore: null });
createMailerooWebhookVerifier({ secret: 's', replayStore: store });
createSmtp2goWebhookVerifier({ username: 'u', password: 'p' });
const azure = createAzureWebhookVerifier({
  token: 't',
  header: 'x-webhook-token',
  replayStore: store,
});
expectType<string | undefined>((await azure.verify({ body: '' })).validation?.validationCode);
expectError(createScalewayWebhookVerifier({ topicArns: ['arn'] }));
expectError(createAzureWebhookVerifier({}));
createSesWebhookVerifier({
  topicArns: ['arn'],
  replayStore: null,
  signatureVersions: ['2'],
  certificateTimeoutMs: 5000,
});
expectError(
  createSesWebhookVerifier({ topicArns: ['arn'], replayStore: null, signatureVersions: ['3'] }),
);
createPostmarkWebhookVerifier({
  username: 'u',
  password: 'p',
  onVerify: (report) => {
    expectType<'taken' | 'refused' | 'error'>(report.status);
    expectType<number>(report.durationMs);
  },
});
