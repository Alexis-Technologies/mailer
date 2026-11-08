// Not ported: the entry of ./webhooks/sparkpost, the verifier of the events of
// SparkPost's webhooks.

const { createSparkPostWebhookVerifier } = require('./verifier.js');

module.exports = { createSparkPostWebhookVerifier };
