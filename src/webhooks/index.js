// Not ported: the entry of ./webhooks, the verifiers of the providers' events.

const { WebhookVerificationError, createMemoryReplayStore } = require('./request.js');
const { createAzureWebhookVerifier } = require('./azure.js');
const { createBrevoWebhookVerifier } = require('./brevo.js');
const { createLettermintWebhookVerifier } = require('./lettermint.js');
const { createMailerSendWebhookVerifier } = require('./mailersend.js');
const { createMailjetWebhookVerifier } = require('./mailjet.js');
const { createPostmarkWebhookVerifier } = require('./postmark.js');
const { createScalewayWebhookVerifier } = require('./scaleway.js');
const { createSmtp2goWebhookVerifier } = require('./smtp2go.js');
const { createSparkPostWebhookVerifier } = require('./sparkpost.js');

module.exports = {
  WebhookVerificationError,
  createAzureWebhookVerifier,
  createBrevoWebhookVerifier,
  createLettermintWebhookVerifier,
  createMailerSendWebhookVerifier,
  createMailjetWebhookVerifier,
  createMemoryReplayStore,
  createPostmarkWebhookVerifier,
  createScalewayWebhookVerifier,
  createSmtp2goWebhookVerifier,
  createSparkPostWebhookVerifier,
};
