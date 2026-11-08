// Not ported: the entry of ./webhooks/resend, the verifier of the events of
// Resend, signed by Svix.

const { createResendWebhookVerifier } = require('./verifier.js');

module.exports = { createResendWebhookVerifier };
