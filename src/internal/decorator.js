// Not ported: what the decorators share in forwarding to the transport they
// wrap: its disposal, its verification, and the reading of a caller's abort
// and of what was thrown.

const { isVerifiableTransport } = require('../core/transport.js');
const { isCallerAbort } = require('./abort.js');

/**
 * Disposes of a transport that supports disposal, asynchronous or not.
 *
 * @internal
 */
const disposeOf = async (transport) => {
  const target = Object(transport);
  if (typeof target[Symbol.asyncDispose] === 'function') await target[Symbol.asyncDispose]();
  else if (typeof target[Symbol.dispose] === 'function') target[Symbol.dispose]();
};

/**
 * Verifies a transport that can verify; one that cannot has nothing to check.
 *
 * @internal
 */
const verifyWrapped = async (transport, options) => {
  options?.signal?.throwIfAborted();
  if (isVerifiableTransport(transport)) await transport.verify(options);
};

/**
 * The text of what was thrown.
 *
 * @internal
 */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

module.exports = { disposeOf, isCallerAbort, messageOf, verifyWrapped };
