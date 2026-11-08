// Not ported: the entry of ./webhooks/mailersend, the verifier of the events of
// MailerSend's webhooks.

const { createMailerSendWebhookVerifier } = require('./verifier.js');

module.exports = { createMailerSendWebhookVerifier };
