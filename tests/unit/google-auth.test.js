// Not ported: tests of the access token of a service account of Google
// (internal/google-auth.js), against a fetch of the test's own.
const { test } = require('node:test');
const assert = require('node:assert');
const { Buffer } = require('node:buffer');
const { generateKeyPairSync, verify } = require('node:crypto');
const { createGoogleAuth } = require('../../src/internal/google-auth.js');
const { isUnsentRequestError } = require('../../src/internal/unsent.js');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  type: 'service_account',
  client_email: 'fcm@demo.iam.gserviceaccount.com',
  private_key_id: 'kid-1',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  token_uri: 'https://evil.example/token',
};
const SCOPES = ['https://www.googleapis.com/auth/firebase.messaging'];

const tokenServer = (
  answer = () => Response.json({ access_token: 'ya29.a', expires_in: 3599 }),
) => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), init, form: new URLSearchParams(init.body) });
    return answer(requests.length);
  };
  return { fetch, requests };
};

test('Google auth: a token is fetched once with an assertion signed by the account', async () => {
  const server = tokenServer();
  let time = Date.parse('2026-11-08T09:00:00Z');
  const auth = createGoogleAuth({
    serviceAccount,
    scopes: SCOPES,
    fetch: server.fetch,
    now: () => time,
  });
  const tokens = await Promise.all([auth.token(), auth.token(), auth.token()]);
  assert.deepStrictEqual(tokens, ['ya29.a', 'ya29.a', 'ya29.a']);
  assert.strictEqual(server.requests.length, 1);
  const [request] = server.requests;
  // Not the token_uri of the file: where the assertion goes is the code's.
  assert.strictEqual(request.url, 'https://oauth2.googleapis.com/token');
  assert.strictEqual(request.init.redirect, 'manual');
  assert.strictEqual(request.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.strictEqual(request.form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header, claims, signature] = request.form.get('assertion').split('.');
  assert.deepStrictEqual(JSON.parse(Buffer.from(header, 'base64url')), {
    alg: 'RS256',
    typ: 'JWT',
    kid: 'kid-1',
  });
  const iat = time / 1000;
  assert.deepStrictEqual(JSON.parse(Buffer.from(claims, 'base64url')), {
    iss: serviceAccount.client_email,
    scope: SCOPES[0],
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  });
  assert.ok(
    verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    ),
  );
  // Held until five minutes before its end, then made anew apart, the one
  // held serving meanwhile (changed by C40).
  time += 54 * 60 * 1000;
  assert.strictEqual(await auth.token(), 'ya29.a');
  time += 2 * 60 * 1000;
  assert.strictEqual(await auth.token(), 'ya29.a');
  for (let i = 0; i < 20 && server.requests.length < 2; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.strictEqual(server.requests.length, 2);
  auth.invalidate('ya29.a');
  await auth.token();
  assert.strictEqual(server.requests.length, 3);
});

test('Google auth: a refused account is auth, and no request of the provider went', async () => {
  const refused = tokenServer(() =>
    Response.json(
      { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' },
      { status: 400 },
    ),
  );
  await assert.rejects(
    createGoogleAuth({ serviceAccount, scopes: SCOPES, fetch: refused.fetch }).token(),
    (error) => {
      assert.match(error.message, /Invalid JWT Signature/);
      assert.strictEqual(error.statusCode, 400);
      assert.strictEqual(error.category, 'auth');
      assert.strictEqual(error.retryable, false);
      assert.ok(isUnsentRequestError(error));
      return true;
    },
  );
  const down = tokenServer(() => new Response('upstream', { status: 503 }));
  await assert.rejects(
    createGoogleAuth({ serviceAccount, scopes: SCOPES, fetch: down.fetch }).token(),
    (error) => {
      assert.strictEqual(error.statusCode, 503);
      assert.strictEqual(error.category, undefined);
      assert.ok(isUnsentRequestError(error));
      return true;
    },
  );
  const lost = createGoogleAuth({
    serviceAccount,
    scopes: SCOPES,
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(lost.token(), (error) => isUnsentRequestError(error));
  const empty = tokenServer(() => Response.json({ token_type: 'Bearer' }));
  await assert.rejects(
    createGoogleAuth({ serviceAccount, scopes: SCOPES, fetch: empty.fetch }).token(),
    (error) => /no access_token/.test(error.message) && isUnsentRequestError(error),
  );
  const huge = tokenServer(() => new Response('x'.repeat(70_000)));
  await assert.rejects(
    createGoogleAuth({ serviceAccount, scopes: SCOPES, fetch: huge.fetch }).token(),
    (error) => error instanceof RangeError && isUnsentRequestError(error),
  );
});

test('Google auth: the account, its key, the scopes and the URL are checked when made', async () => {
  const make = (options) => () => createGoogleAuth({ serviceAccount, scopes: SCOPES, ...options });
  assert.throws(make({ serviceAccount: null }), /service account/);
  assert.throws(
    make({ serviceAccount: { ...serviceAccount, client_email: '' } }),
    /service account/,
  );
  assert.throws(
    make({ serviceAccount: { ...serviceAccount, type: 'authorized_user' } }),
    /authorized_user/,
  );
  assert.throws(make({ serviceAccount: { ...serviceAccount, private_key: 'x' } }), /private_key/);
  assert.throws(make({ scopes: [] }), /scopes/);
  assert.throws(make({ tokenUrl: 'http://tokens.example/token' }), /HTTPS/);
  assert.throws(make({ timeout: 0 }), RangeError);
  const { private_key_id: _kid, ...unkeyed } = serviceAccount;
  const server = tokenServer();
  await createGoogleAuth({
    serviceAccount: unkeyed,
    scopes: SCOPES,
    tokenUrl: 'http://127.0.0.1:9/token',
    fetch: server.fetch,
  }).token();
  // A loopback URL for a test, and no kid for an account without its id.
  assert.strictEqual(server.requests[0].url, 'http://127.0.0.1:9/token');
  const header = server.requests[0].form.get('assertion').split('.')[0];
  assert.deepStrictEqual(JSON.parse(Buffer.from(header, 'base64url')), {
    alg: 'RS256',
    typ: 'JWT',
  });
});
