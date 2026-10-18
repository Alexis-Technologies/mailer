// Not ported: what the transports of the HTTP providers of 1.1 are made of
// alike: their configuration and its client, the redaction of the secrets
// they hold, and a sendMany() of single sends at a time.

const { sendManyConcurrently } = require('./batch.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('./redact.js');

/**
 * The base of a transport of an HTTP provider: its `id`; its `config`, made
 * by `createConfig`, and its `httpClient`, by `createClient` of it; its
 * `toJSON()` and inspection, the secrets redacted; and a `sendMany()` of its
 * `send()`, `concurrency` at a time, which a provider with a batch API
 * replaces.
 *
 * @internal
 */
class ProviderTransport {
  constructor(id, config, createConfig, createClient) {
    this.id = id;
    this.config = createConfig(config);
    this.httpClient = createClient(this.config);
  }

  toJSON() {
    return redactSecrets(this);
  }

  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Sends messages `concurrency` at a time, the receipts in their order.
   */
  sendMany(messages, options) {
    return sendManyConcurrently(this, messages, options);
  }
}

module.exports = { ProviderTransport };
