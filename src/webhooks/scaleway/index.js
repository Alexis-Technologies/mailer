// Not ported: the entry of ./webhooks/scaleway, the verifier of the events of
// Scaleway Transactional Email, posted by its Topics and Events.

const { createScalewayWebhookVerifier } = require('./verifier.js');

module.exports = { createScalewayWebhookVerifier };
