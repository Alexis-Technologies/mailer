// Ported from upyo v0.7.0 (packages/core/src/transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Checks whether a transport exposes raw MIME delivery.
 * @param transport The transport to inspect.
 * @returns Whether the transport implements the optional raw capability.
 */
const isRawTransport = (transport) => {
  return 'sendRaw' in transport && typeof transport.sendRaw === 'function';
};

/**
 * Checks whether a transport exposes configuration verification.
 * @param transport The transport to inspect.
 * @returns Whether the transport implements the optional verification capability.
 */
const isVerifiableTransport = (transport) => {
  return 'verify' in transport && typeof transport.verify === 'function';
};

module.exports = { isRawTransport, isVerifiableTransport };
