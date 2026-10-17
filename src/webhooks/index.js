// Not ported: the entry of ./webhooks, the verifiers of the providers' events.

const { WebhookVerificationError, createMemoryReplayStore } = require('./request.js');
const { createBrevoWebhookVerifier } = require('./brevo.js');
const { createMailerSendWebhookVerifier } = require('./mailersend.js');
const { createMailgunWebhookVerifier } = require('./mailgun.js');
const { createMailjetWebhookVerifier } = require('./mailjet.js');
const { createMailtrapWebhookVerifier } = require('./mailtrap.js');
const { createPostmarkWebhookVerifier } = require('./postmark.js');
const { createResendWebhookVerifier } = require('./resend.js');
const { createSendGridWebhookVerifier } = require('./sendgrid.js');
const { createSesWebhookVerifier } = require('./ses.js');
const { createSparkPostWebhookVerifier } = require('./sparkpost.js');

module.exports = {
  WebhookVerificationError,
  createBrevoWebhookVerifier,
  createMailerSendWebhookVerifier,
  createMailgunWebhookVerifier,
  createMailjetWebhookVerifier,
  createMailtrapWebhookVerifier,
  createMemoryReplayStore,
  createPostmarkWebhookVerifier,
  createResendWebhookVerifier,
  createSendGridWebhookVerifier,
  createSesWebhookVerifier,
  createSparkPostWebhookVerifier,
};
