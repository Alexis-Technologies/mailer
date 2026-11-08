// Not ported: the entry of ./webhooks/ses, the verifier of the events of
// Amazon SES, delivered by SNS.

const { createSesWebhookVerifier } = require('./verifier.js');

module.exports = { createSesWebhookVerifier };
