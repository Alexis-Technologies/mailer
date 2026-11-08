// Not ported: the entry of ./webhooks/mailgun, the verifier of the events of
// Mailgun's webhooks.

const { createMailgunWebhookVerifier } = require('./verifier.js');

module.exports = { createMailgunWebhookVerifier };
