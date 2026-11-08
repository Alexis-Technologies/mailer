// Not ported: the entry of ./webhooks/mailtrap, the verifier of the events of
// Mailtrap's sending webhooks.

const { createMailtrapWebhookVerifier } = require('./verifier.js');

module.exports = { createMailtrapWebhookVerifier };
