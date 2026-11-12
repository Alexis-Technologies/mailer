// Not ported: VAPID (RFC 8292), the identity of an application server to a
// push service: a JWT of ES256 for the origin of the endpoint, signed with
// the private key of the application, held per origin for twelve hours.
// Written from the RFC, as web-push is MPL-2.0; the key pair is checked when
// the transport is made, where web-push threw it from a send (V14).

const { Buffer } = require('node:buffer');
const { createECDH, createPrivateKey } = require('node:crypto');
const { privateKeyOf, signJwt } = require('../internal/jwt.js');

// What a push service allows a JWT, a day at most: twelve hours, renewed an
// hour before its end.
const LIFETIME_SECONDS = 12 * 60 * 60;
const RENEW_SECONDS = 60 * 60;
const MAX_AUDIENCES = 100;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const bytesOf = (value, length, name) => {
  const bytes =
    typeof value === 'string' && BASE64URL.test(value)
      ? Buffer.from(value, 'base64url')
      : undefined;
  if (bytes === undefined || bytes.length !== length) {
    throw new TypeError(`vapid.${name} must be ${length} bytes in base64url.`);
  }
  return bytes;
};

// The private key, a scalar of P-256 in 32 bytes. Node's getPrivateKey()
// writes it without its leading zero bytes, so one of some 300 keys it makes
// is shorter: such a key is the same scalar, padded back to the 32 bytes the
// JWK of the key takes.
const scalarOf = (value) => {
  const bytes =
    typeof value === 'string' && BASE64URL.test(value)
      ? Buffer.from(value, 'base64url')
      : undefined;
  if (bytes === undefined || bytes.length === 0 || bytes.length > 32) {
    throw new TypeError('vapid.privateKey must be 32 bytes in base64url.');
  }
  if (bytes.length === 32) return bytes;
  const padded = Buffer.alloc(32);
  bytes.copy(padded, 32 - bytes.length);
  return padded;
};

/**
 * Checks the VAPID keys and subject of the transport.
 *
 * @param vapid `{ subject, publicKey, privateKey }`, the keys in base64url.
 * @returns `{ subject, publicKey, key }`, the key an object of node:crypto.
 * @throws {TypeError} If a key is no key of P-256, the two are no pair, or
 * the subject is neither a `mailto:` nor an `https:` URL.
 * @internal
 */
const checkVapid = (vapid) => {
  if (vapid === null || typeof vapid !== 'object') {
    throw new TypeError('WebPushTransport needs vapid: { subject, publicKey, privateKey }.');
  }
  const subject = vapid.subject;
  if (typeof subject !== 'string' || !/^(?:mailto:\S+|https:\/\/\S+)$/.test(subject)) {
    throw new TypeError('vapid.subject must be a mailto: or an https: URL.');
  }
  const publicKey = bytesOf(vapid.publicKey, 65, 'publicKey');
  const privateKey = scalarOf(vapid.privateKey);
  const ecdh = createECDH('prime256v1');
  try {
    ecdh.setPrivateKey(privateKey);
  } catch (error) {
    throw new TypeError('vapid.privateKey is no key of P-256.', { cause: error });
  }
  if (!ecdh.getPublicKey().equals(publicKey)) {
    throw new TypeError('vapid.publicKey is not the public key of vapid.privateKey.');
  }
  const key = privateKeyOf(
    createPrivateKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        d: privateKey.toString('base64url'),
        x: publicKey.subarray(1, 33).toString('base64url'),
        y: publicKey.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    }),
    'ES256',
    'vapid.privateKey',
  );
  return { subject, publicKey: vapid.publicKey, key };
};

/**
 * The header of authorization of a request to an endpoint, its JWT held per
 * origin.
 *
 * @param vapid What `checkVapid` gave.
 * @param now The clock, in milliseconds.
 * @returns `authorizationOf(endpoint)`.
 * @internal
 */
const createVapid = (vapid, now) => {
  const tokens = new Map();
  return (endpoint) => {
    const audience = new URL(endpoint).origin;
    const seconds = Math.floor(now() / 1000);
    let held = tokens.get(audience);
    if (held === undefined || held.expiresAt - RENEW_SECONDS <= seconds) {
      const expiresAt = seconds + LIFETIME_SECONDS;
      held = {
        expiresAt,
        token: signJwt(
          { typ: 'JWT', alg: 'ES256' },
          { aud: audience, exp: expiresAt, sub: vapid.subject },
          vapid.key,
        ),
      };
      tokens.delete(audience);
      tokens.set(audience, held);
      if (tokens.size > MAX_AUDIENCES) tokens.delete(tokens.keys().next().value);
    }
    return `vapid t=${held.token}, k=${vapid.publicKey}`;
  };
};

module.exports = { checkVapid, createVapid };
