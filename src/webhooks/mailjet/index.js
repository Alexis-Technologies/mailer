// Not ported: the entry of ./webhooks/mailjet, the verifier of the events of
// Mailjet's Event API.

const { createMailjetWebhookVerifier } = require('./verifier.js');

module.exports = { createMailjetWebhookVerifier };
