// Not ported: the entry of ./webhooks/sendgrid, the verifier of the events of
// SendGrid's Signed Event Webhook.

const { createSendGridWebhookVerifier } = require('./verifier.js');

module.exports = { createSendGridWebhookVerifier };
