// Not ported: the entry of ./webhooks/azure, the verifier of the events of
// Azure Communication Services, delivered by Event Grid.

const { createAzureWebhookVerifier } = require('./verifier.js');

module.exports = { createAzureWebhookVerifier };
