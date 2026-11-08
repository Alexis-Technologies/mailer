// Not ported: the entry of ./webhooks/brevo, the verifier of the events of
// Brevo's transactional webhooks.

const { createBrevoWebhookVerifier } = require('./verifier.js');

module.exports = { createBrevoWebhookVerifier };
