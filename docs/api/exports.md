# Exports

The package has one root entry and a subpath per transport and decorator, each
with its own hand-written types. Every name is exported by name, so `require()`
and ESM `import` give the same values:

```js
const { createMessage } = require('@alexify/mailer');
const { SmtpTransport } = require('@alexify/mailer/smtp');
```

```js
import { createMessage } from '@alexify/mailer';
import { SmtpTransport } from '@alexify/mailer/smtp';
```

## `@alexify/mailer`

The message model and the transport contract, ported from `@upyo/core`, and the
model of delivery events.

- **Messages:** `createMessage`, and the `Message`, `MessageConstructor`,
  `MessageContent`, `Address`, `Attachment` and `Priority` types, with the
  `ListFields`, `ListUrl` and `MessageTracking` of the `list` and `tracking` fields;
  `parseAddress`, `formatAddress`, `isEmailAddress`, `isAttachment`,
  `comparePriority`. See [composing messages](/messages/compose).
- **Attachments:** `readAttachmentContent`, `iterateAttachmentContent`. See
  [attachments](/messages/attachments).
- **Calendar:** `createCalendarAttachment`, `resolveCalendarContent`,
  `parseCalendarMethod`. See [calendar invitations](/messages/calendar).
- **Message-ID and threading:** `generateMessageId`, `parseMessageId`,
  `formatMessageId`, `resolveThreadingHeaders`.
- **Transports:** the `Transport`, `RawTransport`, `VerifiableTransport` and
  `TransportOptions` types; `isRawTransport`, `isVerifiableTransport`,
  `combineSignals`. See [custom transports](/transports/custom).
- **Receipts:** the `Receipt` and `ReceiptError` types; `createFailedReceipt`,
  `createReceiptError`, `classifyHttpStatus`, `classifyReceiptError`,
  `parseRetryAfter`.
- **Raw messages:** the `RawMessage` type; `createRawMessagePlan`,
  `iterateRawMessage`, `analyzeRawMessage`, `RawMessageValidationError`.
- **Delivery events:** the `DeliveryEvent`, `DeliveryEventType` and
  `DeliveryBounce` types, which `./webhooks` gives. See
  [webhooks and events](/guide/webhooks).
- **The reliability layer:** the `QueueDriver`, `QueueSource`, `QueueJob`,
  `QueueJobRequest`, `QueueOutcome` and `QueueHandler` types every driver
  shares, and `MessageState`, `AuditEvent` and `AuditSink`, as types only. See
  [the queue](/guide/queue) and [the audit](/guide/audit).

## Subpaths

| Subpath | Exports | Page |
| --- | --- | --- |
| `@alexify/mailer/mime` | `composeMessage`, `MimeAttachmentReplayError` | [MIME](/messages/mime) |
| `@alexify/mailer/attachments` | `fromPath`, `fromUrl`, `fromDataUri`, `fromStream`, `inlineDataUrls`, `isPublicUrl` | [Attachments](/messages/attachments#files-urls-data-uris-and-streams) |
| `@alexify/mailer/render` | `renderContent`, `renderFields`, `createReactEmailRenderer`, `htmlToText` | [Rendering templates](/messages/render) |
| `@alexify/mailer/templates` | `createTemplateRenderer`, `createFileLoader`, `createMemoryLoader`, `createCssInliner`, `createEjsEngine`, `createHandlebarsEngine`, `createPugEngine`, `createMjmlEngine`, `createLiquidEngine`, `createNunjucksEngine`, `createEtaEngine`, `createMustacheEngine`, `createReactEmailEngine`, `TemplateNotFoundError`, `TemplateRenderError` | [Templates by name](/messages/templates) |
| `@alexify/mailer/queue` | `createMailQueue`, `createMailJobHandler`, `createMemoryQueue`, `createPollingDriver`, `prepareMailJob`, `parseMailJob`, `MailQueueError`, `QueueLeaseLostError`, `MAIL_JOB_NAME`, `MAIL_JOB_VERSION` | [The queue](/guide/queue) |
| `@alexify/mailer/bullmq` | `createBullMQDriver`, `createBullMQProcessor`, `createBullMQBackoffStrategy`, `MAILER_BACKOFF_TYPE` | [BullMQ](/transports/bullmq) |
| `@alexify/mailer/audit` | `createMemoryAuditSink`, `createLoggerAuditSink`, `combineAuditSinks`, `stateOf`, `stateOfDeliveryEvent`, `auditEventOfDeliveryEvent`, `isFinalState` | [The audit](/guide/audit) |
| `@alexify/mailer/webhooks` | `createSesWebhookVerifier`, `createResendWebhookVerifier`, `createSendGridWebhookVerifier`, `createMailgunWebhookVerifier`, `createPostmarkWebhookVerifier`, `createMailerSendWebhookVerifier`, `createMailtrapWebhookVerifier`, `createBrevoWebhookVerifier`, `createMailjetWebhookVerifier`, `createSparkPostWebhookVerifier`, `createLettermintWebhookVerifier`, `createMailerooWebhookVerifier`, `createSmtp2goWebhookVerifier`, `createAzureWebhookVerifier`, `createScalewayWebhookVerifier`, `createMemoryReplayStore`, `WebhookVerificationError` | [Webhooks](/guide/webhooks) |
| `@alexify/mailer/smtp` | `SmtpTransport` and its error classes (`SmtpResponseError`, `SmtpAuthError`, …), `isSmtpResponseProviderDetails`, `createHttpProxyConnector` | [SMTP](/transports/smtp) |
| `@alexify/mailer/sendmail` | `SendmailTransport` | [Sendmail](/transports/sendmail) |
| `@alexify/mailer/ses` | `SesTransport` | [Amazon SES](/transports/ses) |
| `@alexify/mailer/resend` | `ResendTransport` | [Resend](/transports/resend) |
| `@alexify/mailer/sendgrid` | `SendGridTransport`, `SendGridApiError` | [SendGrid](/transports/sendgrid) |
| `@alexify/mailer/mailgun` | `MailgunTransport`, `MailgunApiError` | [Mailgun](/transports/mailgun) |
| `@alexify/mailer/mailtrap` | `MailtrapTransport`, `createMailtrapConfig` and its error classes | [Mailtrap](/transports/mailtrap) |
| `@alexify/mailer/maileroo` | `MailerooTransport`, `createMailerooConfig` and its error classes | [Maileroo](/transports/maileroo) |
| `@alexify/mailer/lettermint` | `LettermintTransport`, `createLettermintConfig` and its error classes | [Lettermint](/transports/lettermint) |
| `@alexify/mailer/plunk` | `PlunkTransport` | [Plunk](/transports/plunk) |
| `@alexify/mailer/postmark` | `PostmarkTransport` | [Postmark](/transports/postmark) |
| `@alexify/mailer/brevo` | `BrevoTransport` | [Brevo](/transports/brevo) |
| `@alexify/mailer/mailjet` | `MailjetTransport` | [Mailjet](/transports/mailjet) |
| `@alexify/mailer/mailersend` | `MailerSendTransport` | [MailerSend](/transports/mailersend) |
| `@alexify/mailer/sparkpost` | `SparkPostTransport` | [SparkPost](/transports/sparkpost) |
| `@alexify/mailer/zeptomail` | `ZeptoMailTransport` | [ZeptoMail](/transports/zeptomail) |
| `@alexify/mailer/smtp2go` | `Smtp2goTransport` | [SMTP2GO](/transports/smtp2go) |
| `@alexify/mailer/azure` | `AzureTransport` | [Azure Communication Services](/transports/azure) |
| `@alexify/mailer/scaleway` | `ScalewayTransport` | [Scaleway](/transports/scaleway) |
| `@alexify/mailer/cloudflare` | `CloudflareTransport` | [Cloudflare](/transports/cloudflare) |
| `@alexify/mailer/jmap` | `JmapTransport`, `createJmapConfig`, `JmapApiError`, `JMAP_ERROR_TYPES`, `isCapabilityError`, `uploadBlob` | [JMAP](/transports/jmap) |
| `@alexify/mailer/mock` | `MockTransport` | [Mock](/transports/mock) |
| `@alexify/mailer/pool` | `PoolTransport`, `RoundRobinStrategy`, `WeightedStrategy`, `PriorityStrategy`, `SelectorStrategy` | [Pool](/transports/pool) |
| `@alexify/mailer/retry` | `RetryTransport`, `createRetryTransport` | [Retry](/transports/retry) |
| `@alexify/mailer/otel` | `OpenTelemetryTransport`, `createOpenTelemetryTransport`, `createEmailAttributeExtractor`, `createErrorClassifier`, `defaultErrorClassifier` | [OpenTelemetry](/transports/otel) |
| `@alexify/mailer/logger` | `LoggerTransport` | [Logger](/transports/logger) |
| `@alexify/mailer/breaker` | `CircuitBreakerTransport` | [Circuit breaker](/transports/breaker) |
| `@alexify/mailer/ratelimit` | `RateLimitTransport` | [Rate limit](/transports/ratelimit) |
| `@alexify/mailer/idempotency` | `IdempotencyTransport`, `createMemoryIdempotencyStore` | [Idempotency](/transports/idempotency) |
| `@alexify/mailer/hooks` | `HooksTransport` | [Hooks](/transports/hooks) |
| `@alexify/mailer/tee` | `TeeTransport` | [Tee](/transports/tee) |

The types of each subpath (configurations, receipts with provider details, the
structural `TracerProvider`, `MeterProvider` and `Logger` of the decorators) are in
its `index.d.ts`, next to the code in `src/<subpath>/`.
