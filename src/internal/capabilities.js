// Not ported: the receipt of a decorator asked for what the transport it wraps
// cannot do, such as `sendRaw()` of one that composes every message itself.

const { createFailedReceipt } = require('../core/receipt.js');

/**
 * The failed receipt of `sendRaw()` through a decorator whose transport has
 * none: a configuration error, not retried and not failed over.
 *
 * @param transport The transport that cannot send raw messages.
 * @returns The receipt.
 * @internal
 */
const refuseRaw = (transport) =>
  createFailedReceipt(`The transport ${transport.id} does not send raw messages.`, {
    provider: transport.id,
    category: 'configuration',
    retryable: false,
  });

module.exports = { refuseRaw };
