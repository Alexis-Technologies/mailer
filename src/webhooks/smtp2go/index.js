// Not ported: the entry of ./webhooks/smtp2go, the verifier of the events of
// SMTP2GO's webhooks.

const { createSmtp2goWebhookVerifier } = require('./verifier.js');

module.exports = { createSmtp2goWebhookVerifier };
