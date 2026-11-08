// Not ported: the entry of ./webhooks/maileroo, the verifier of the events of
// Maileroo's webhooks.

const { createMailerooWebhookVerifier } = require('./verifier.js');

module.exports = { createMailerooWebhookVerifier };
