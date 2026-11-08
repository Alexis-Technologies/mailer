// Not ported: the entry of ./webhooks/lettermint, the verifier of the events of
// Lettermint's webhooks.

const { createLettermintWebhookVerifier } = require('./verifier.js');

module.exports = { createLettermintWebhookVerifier };
