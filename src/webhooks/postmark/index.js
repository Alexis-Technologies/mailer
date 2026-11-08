// Not ported: the entry of ./webhooks/postmark, the verifier of the events of
// Postmark's webhooks.

const { createPostmarkWebhookVerifier } = require('./verifier.js');

module.exports = { createPostmarkWebhookVerifier };
