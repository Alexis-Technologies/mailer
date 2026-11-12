// Not ported: tests of the JSON Web Tokens of the channels (internal/jwt.js)
// and of the cache of a token (internal/token-cache.js). The signatures are
// checked by WebCrypto, which reads JWS's form of ES256 (R and S) itself, as
// a verifier of the providers does, rather than by the code that signed them.
const { test } = require('node:test');
const assert = require('node:assert');
const { Buffer } = require('node:buffer');
const { generateKeyPairSync, webcrypto } = require('node:crypto');
const { privateKeyOf, signJwt } = require('../../src/internal/jwt.js');
const { createTokenCache } = require('../../src/internal/token-cache.js');

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const partsOf = (jwt) => {
  const [header, claims, signature] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url')),
    claims: JSON.parse(Buffer.from(claims, 'base64url')),
    input: new TextEncoder().encode(`${header}.${claims}`),
    signature: Buffer.from(signature, 'base64url'),
  };
};

test('JWT: RS256 and ES256 are signed as JWS takes them', async () => {
  const pem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const rs = partsOf(
    signJwt({ alg: 'RS256', typ: 'JWT' }, { iss: 'a', exp: 1 }, privateKeyOf(pem, 'RS256', 'key')),
  );
  assert.deepStrictEqual(rs.header, { alg: 'RS256', typ: 'JWT' });
  assert.deepStrictEqual(rs.claims, { iss: 'a', exp: 1 });
  const rsaKey = await webcrypto.subtle.importKey(
    'spki',
    rsa.publicKey.export({ type: 'spki', format: 'der' }),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  assert.ok(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', rsaKey, rs.signature, rs.input));

  const es = partsOf(
    signJwt(
      { alg: 'ES256', kid: 'ABC123' },
      { iss: 'TEAM', iat: 1 },
      privateKeyOf(ec.privateKey, 'ES256', 'key'),
    ),
  );
  // R and S of 32 bytes each, not the DER of OpenSSL.
  assert.strictEqual(es.signature.length, 64);
  const ecKey = await webcrypto.subtle.importKey(
    'spki',
    ec.publicKey.export({ type: 'spki', format: 'der' }),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  assert.ok(
    await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      ecKey,
      es.signature,
      es.input,
    ),
  );
});

test('JWT: a key of another algorithm, or none, is refused', () => {
  const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  assert.throws(() => privateKeyOf(rsa.privateKey, 'ES256', 'The key'), /P-256/);
  assert.throws(() => privateKeyOf(p384.privateKey, 'ES256', 'The key'), /P-256/);
  assert.throws(() => privateKeyOf(ec.privateKey, 'RS256', 'The key'), /RSA/);
  assert.throws(() => privateKeyOf(rsa.publicKey, 'RS256', 'The key'), /RSA/);
  assert.throws(() => privateKeyOf('not a key', 'RS256', 'The key'), /no private key in PEM/);
  assert.throws(() => privateKeyOf(rsa.privateKey, 'HS256', 'The key'), /No JWT algorithm/);
  assert.throws(() => signJwt({ alg: 'none' }, {}, rsa.privateKey), /No JWT algorithm/);
  // PKCS#1, as older key files hold it.
  const pkcs1 = rsa.privateKey.export({ type: 'pkcs1', format: 'pem' });
  assert.strictEqual(privateKeyOf(pkcs1, 'RS256', 'The key').asymmetricKeyType, 'rsa');
});

test('Token cache: one token is made for every caller, and again near its end', async () => {
  let time = 0;
  let made = 0;
  const cache = createTokenCache(
    async () => {
      made++;
      await new Promise((resolve) => setImmediate(resolve));
      return { token: `t${made}`, expiresAt: time + 60 * 60 * 1000 };
    },
    { now: () => time },
  );
  const tokens = await Promise.all([cache.get(), cache.get(), cache.get()]);
  assert.deepStrictEqual(tokens, ['t1', 't1', 't1']);
  assert.strictEqual(made, 1);
  time += 54 * 60 * 1000;
  assert.strictEqual(await cache.get(), 't1');
  // Changed (C40): five minutes before its end, a new one is made apart, the
  // one held serving until it comes.
  time += 2 * 60 * 1000;
  assert.strictEqual(await cache.get(), 't1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(await cache.get(), 't2');
  // A refusal of an old token keeps the new one; of the one held, forgets it.
  cache.invalidate('t1');
  assert.strictEqual(await cache.get(), 't2');
  cache.invalidate('t2');
  assert.strictEqual(await cache.get(), 't3');
});

test('Token cache: a refresh that fails near the end keeps the token held, which serves', async (t) => {
  // Before (C40): in the five minutes before its end, every call waited for
  // the refresh and failed with it, though the token held still served.
  // Before (C53): its failure was told to no one until the token ended.
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text, options) => warnings.push([options?.code, text]));
  let time = 0;
  let calls = 0;
  const cache = createTokenCache(
    async () => {
      calls++;
      if (calls > 1) throw new Error('token endpoint down');
      return { token: 'held', expiresAt: time + 60 * 60 * 1000 };
    },
    { now: () => time },
  );
  assert.strictEqual(await cache.get(), 'held');
  time += 57 * 60 * 1000;
  assert.strictEqual(await cache.get(), 'held');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(await cache.get(), 'held', 'kept after the refresh failed');
  assert.strictEqual(calls, 2, 'not tried again at once');
  assert.deepStrictEqual(warnings, [
    [
      'MAILER_TOKEN_REFRESH_FAILED',
      'A token could not be made anew; the one held serves until it ends: token endpoint down',
    ],
  ]);
  time += 31 * 1000;
  await cache.get();
  assert.strictEqual(calls, 3, 'tried again after a pause');
  // Past its end it is no longer served: the call waits, and fails.
  time += 3 * 60 * 1000;
  await assert.rejects(cache.get(), /token endpoint down/);
});

test('Token cache: a caller who aborts stops waiting, the others get the token', async () => {
  let release;
  const cache = createTokenCache(
    () => new Promise((resolve) => (release = () => resolve({ token: 't', expiresAt: Infinity }))),
  );
  const controller = new AbortController();
  const reason = new Error('left');
  const leaving = cache.get(controller.signal);
  const staying = cache.get();
  controller.abort(reason);
  await assert.rejects(leaving, (error) => error === reason);
  release();
  assert.strictEqual(await staying, 't');
  await assert.rejects(cache.get(AbortSignal.abort(reason)), (error) => error === reason);
});

test('Token cache: a failure fails those waiting, and the next call tries again', async () => {
  let calls = 0;
  const cache = createTokenCache(async () => {
    calls++;
    if (calls === 1) throw new Error('down');
    if (calls === 2) return { token: 't' };
    return { token: 't', expiresAt: Infinity };
  });
  await assert.rejects(Promise.all([cache.get(), cache.get()]), /down/);
  await assert.rejects(cache.get(), /without its expiry/);
  assert.strictEqual(await cache.get(), 't');
  assert.strictEqual(calls, 3);
});

test('Token cache: each caller waiting fails with an error of its own, of the same kind', async () => {
  // Before: every caller got the one error, so a mark one request put on it
  // (of unknown delivery, after an earlier attempt of its own) was read by
  // another, which was never sent.
  const { isUnsentRequestError, markUnsent } = require('../../src/internal/unsent.js');
  const {
    isDeliveryUnknown,
    markDeliveryUnknown,
  } = require('../../src/internal/delivery-unknown.js');
  const refused = Object.assign(new RangeError('Google refused the token'), {
    statusCode: 401,
    category: 'auth',
    retryable: false,
  });
  markUnsent(refused);
  let release;
  const cache = createTokenCache(
    () =>
      new Promise((_resolve, reject) => {
        release = () => reject(refused);
      }),
  );
  const first = cache.get().catch((error) => error);
  const second = cache.get().catch((error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.notStrictEqual(a, b);
  for (const error of [a, b]) {
    assert.ok(error instanceof RangeError);
    assert.strictEqual(error.message, 'Google refused the token');
    assert.strictEqual(error.statusCode, 401);
    assert.strictEqual(error.category, 'auth');
    assert.strictEqual(isUnsentRequestError(error), true);
  }
  markDeliveryUnknown(a, 'server-error');
  assert.strictEqual(isDeliveryUnknown(b), false);
  // The reason of a caller's abort is given as it is.
  const hang = createTokenCache(() => new Promise(() => {}));
  const controller = new AbortController();
  const reason = new Error('stop');
  const waiting = hang.get(controller.signal).catch((error) => error);
  controller.abort(reason);
  assert.strictEqual(await waiting, reason);
});

test('Channel failure: a token refused after an attempt of unknown delivery keeps it so', () => {
  // Before: a failure that named its category (a token of Google refused) made
  // a definite auth failure of a message an earlier attempt may have posted.
  const { channelFailure } = require('../../src/internal/channel/failure.js');
  const { markDeliveryUnknown } = require('../../src/internal/delivery-unknown.js');
  const error = Object.assign(new Error('Google refused the token of the service account'), {
    statusCode: 401,
    category: 'auth',
    retryable: false,
    attempts: 2,
  });
  markDeliveryUnknown(error, 'server-error');
  const receipt = channelFailure('google-chat', 'google-chat', error);
  assert.strictEqual(receipt.deliveryUnknown, true);
  assert.strictEqual(receipt.deliveryUnknownReason, 'server-error');
  assert.strictEqual(receipt.attempts, 2);
  assert.strictEqual(receipt.errors[0].category, 'auth');
  assert.strictEqual(receipt.retryable, false);
});
