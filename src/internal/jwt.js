// Not ported: the JSON Web Tokens the providers of the channels sign
// themselves, on node:crypto: RS256 for a service account of Google (FCM,
// RBM, Google Chat) and ES256 for the token of APNs, the signature of ES256
// in the form JWS takes (R and S, RFC 7518 §3.4), not the DER of OpenSSL.

const { Buffer } = require('node:buffer');
const { createPrivateKey, sign } = require('node:crypto');

const ALGORITHMS = new Map([
  ['RS256', { type: 'rsa', options: undefined }],
  ['ES256', { type: 'ec', curve: 'prime256v1', options: { dsaEncoding: 'ieee-p1363' } }],
]);

const base64url = (text) => Buffer.from(text).toString('base64url');

/**
 * Reads the private key of an algorithm, a PEM (PKCS#8, or PKCS#1 for RSA) or
 * a key object, and checks that it is a key of that algorithm.
 *
 * @param key The key.
 * @param algorithm `RS256` or `ES256`.
 * @param name How the error names it.
 * @returns The key object.
 * @throws {TypeError} If it is no private key of the algorithm.
 * @internal
 */
const privateKeyOf = (key, algorithm, name) => {
  const spec = ALGORITHMS.get(algorithm);
  if (spec === undefined) throw new TypeError(`No JWT algorithm ${algorithm}.`);
  let object;
  try {
    object = typeof key === 'string' ? createPrivateKey(key) : key;
  } catch (error) {
    throw new TypeError(`${name} is no private key in PEM.`, { cause: error });
  }
  const details = object?.asymmetricKeyDetails;
  if (
    object?.type !== 'private' ||
    object.asymmetricKeyType !== spec.type ||
    (spec.curve !== undefined && details?.namedCurve !== spec.curve)
  ) {
    throw new TypeError(
      `${name} must be a private key of ${algorithm === 'ES256' ? 'P-256' : 'RSA'}.`,
    );
  }
  return object;
};

/**
 * Signs a JWT: its header and claims as JSON in base64url, and the signature
 * of the algorithm the header names.
 *
 * @param header The header, `alg` among it.
 * @param claims The claims.
 * @param key The key of `privateKeyOf`.
 * @returns The compact form, `header.claims.signature`.
 * @internal
 */
const signJwt = (header, claims, key) => {
  const spec = ALGORITHMS.get(header.alg);
  if (spec === undefined) throw new TypeError(`No JWT algorithm ${header.alg}.`);
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = sign(
    'sha256',
    Buffer.from(input),
    spec.options === undefined ? key : { key, ...spec.options },
  );
  return `${input}.${signature.toString('base64url')}`;
};

module.exports = { privateKeyOf, signJwt };
