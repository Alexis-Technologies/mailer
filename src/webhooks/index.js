// Not ported: the entry of ./webhooks, the verifiers of the providers' events.

const { WebhookVerificationError, createMemoryReplayStore } = require('./request.js');
const { createAzureWebhookVerifier } = require('./azure.js');
const { createScalewayWebhookVerifier } = require('./scaleway.js');
const { createSmtp2goWebhookVerifier } = require('./smtp2go.js');
const { createSparkPostWebhookVerifier } = require('./sparkpost.js');

module.exports = {
  WebhookVerificationError,
  createAzureWebhookVerifier,
  createMemoryReplayStore,
  createScalewayWebhookVerifier,
  createSmtp2goWebhookVerifier,
  createSparkPostWebhookVerifier,
};
