// Not ported: `verify()` of the HTTP providers (after sently's), one
// authenticated read each, with `fetch` stubbed.
const { test } = require('node:test');
const assert = require('node:assert');
const { isVerifiableTransport } = require('../../index.js');
const { SesTransport } = require('../../src/ses/index.js');
const { SendGridTransport } = require('../../src/sendgrid/index.js');
const { ResendTransport } = require('../../src/resend/index.js');
const { MailgunTransport } = require('../../src/mailgun/index.js');

// Answers each request with the next of `answers`, and keeps the requests.
const stub = (t, ...answers) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    requests.push({ url: String(input), method: init.method, headers: init.headers });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer();
  });
  return requests;
};
const json = (status, body) => () => Response.json(body, { status });

const ses = () =>
  new SesTransport({
    authentication: { type: 'credentials', accessKeyId: 'AKID', secretAccessKey: 'secret' },
    region: 'eu-west-1',
    retries: 1,
  });

test('Verify: every HTTP provider with a check is verifiable', () => {
  for (const transport of [
    ses(),
    new SendGridTransport({ apiKey: 'SG.key' }),
    new ResendTransport({ apiKey: 're_key' }),
    new MailgunTransport({ apiKey: 'key', domain: 'mg.example.com' }),
  ]) {
    assert.ok(isVerifiableTransport(transport), transport.id);
  }
});

test('Verify: SES reads the account, signed, and takes AccessDenied for a known key', async (t) => {
  const requests = stub(
    t,
    json(200, { SendQuota: {} }),
    json(403, { message: 'User is not authorized to perform: ses:GetAccount' }),
    json(401, { message: 'The security token included in the request is invalid.' }),
  );
  await ses().verify();
  assert.strictEqual(requests[0].url, 'https://email.eu-west-1.amazonaws.com/v2/email/account');
  assert.strictEqual(requests[0].method, 'GET');
  assert.match(
    requests[0].headers.authorization ?? requests[0].headers.Authorization,
    /^AWS4-HMAC-SHA256 /,
  );
  await ses().verify();
  await assert.rejects(ses().verify(), (error) => {
    assert.strictEqual(error.statusCode, 401);
    assert.match(error.message, /^SES refused the credentials: .*token .* is invalid/);
    return true;
  });
});

test('Verify: a read is retried after a network failure, never taken for a delivery', async (t) => {
  // The shortest jittered wait: half of the first delay.
  t.mock.method(Math, 'random', () => 0);
  const requests = stub(
    t,
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
    json(200, {}),
  );
  await ses().verify();
  assert.strictEqual(requests.length, 2);
  stub(t, json(500, { message: 'oops' }));
  const once = new SesTransport({
    authentication: { type: 'credentials', accessKeyId: 'AKID', secretAccessKey: 'secret' },
    retries: 0,
  });
  await assert.rejects(
    once.verify(),
    (error) => error.deliveryUnknown !== true && /500|oops/.test(error.message),
  );
});

test('Verify: SendGrid wants the mail.send scope', async (t) => {
  const requests = stub(
    t,
    json(200, { scopes: ['mail.send', 'user.profile.read'] }),
    json(200, { scopes: ['user.profile.read'] }),
    json(401, { errors: [{ message: 'The provided authorization grant is invalid' }] }),
    () => new Response('not json', { status: 200 }),
  );
  const sendgrid = new SendGridTransport({ apiKey: 'SG.key', retries: 0 });
  await sendgrid.verify();
  assert.strictEqual(requests[0].url, 'https://api.sendgrid.com/v3/scopes');
  await assert.rejects(sendgrid.verify(), /no mail\.send scope/);
  await assert.rejects(sendgrid.verify(), /SendGrid refused the credentials/);
  await assert.rejects(sendgrid.verify(), /no mail\.send scope/);
});

test('Verify: Resend takes a sending-only key, refuses an invalid one', async (t) => {
  const requests = stub(
    t,
    json(200, { data: [] }),
    json(401, {
      name: 'restricted_api_key',
      message: 'This API key is restricted to only send emails',
    }),
    json(401, { name: 'validation_error', message: 'API key is invalid' }),
    () => new Response('<html>', { status: 401 }),
  );
  const resend = new ResendTransport({ apiKey: 're_key', retries: 0 });
  await resend.verify();
  assert.strictEqual(requests[0].url, 'https://api.resend.com/domains');
  await resend.verify();
  await assert.rejects(resend.verify(), /Resend refused the credentials: .*API key is invalid/);
  await assert.rejects(resend.verify(), /Resend refused the credentials/);
});

test('Verify: Mailgun reads the domain, takes a sending key, fails on an unknown domain', async (t) => {
  const requests = stub(
    t,
    json(200, { domain: { name: 'mg.example.com' } }),
    json(403, { message: 'Forbidden' }),
    json(404, { message: 'Domain not found' }),
  );
  const mailgun = new MailgunTransport({ apiKey: 'key', domain: 'mg.example.com', retries: 0 });
  await mailgun.verify();
  assert.strictEqual(requests[0].url, 'https://api.mailgun.net/v3/domains/mg.example.com');
  await mailgun.verify();
  await assert.rejects(mailgun.verify(), (error) => {
    assert.strictEqual(error.statusCode, 404);
    assert.match(error.message, /Mailgun answered the check with HTTP 404: .*Domain not found/);
    return true;
  });
  const long = 'x'.repeat(500);
  stub(t, json(400, { message: long }));
  await assert.rejects(mailgun.verify(), (error) => error.message.length < 300);
});

test('Verify: an aborted signal rejects before any request', async (t) => {
  const requests = stub(t);
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  for (const transport of [
    ses(),
    new SendGridTransport({ apiKey: 'SG.key' }),
    new ResendTransport({ apiKey: 're_key' }),
    new MailgunTransport({ apiKey: 'key', domain: 'mg.example.com' }),
  ]) {
    await assert.rejects(transport.verify({ signal: controller.signal }), /stop/);
  }
  assert.strictEqual(requests.length, 0);
});

test('Verify: a 403 verifies only where a key that may only send is refused with it', async (t) => {
  // Before: a 403 verified the credentials of every provider, so a key
  // Postmark or Brevo refused passed verify().
  const { PostmarkTransport } = require('../../src/postmark/index.js');
  const { BrevoTransport } = require('../../src/brevo/index.js');
  const { SparkPostTransport } = require('../../src/sparkpost/index.js');
  const { MailerSendTransport } = require('../../src/mailersend/index.js');
  const { ScalewayTransport } = require('../../src/scaleway/index.js');
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: 'Forbidden' }, { status: 403 }),
  );
  const refused = [
    new PostmarkTransport({ serverToken: 'token', retries: 0 }),
    new BrevoTransport({ apiKey: 'key', retries: 0 }),
  ];
  for (const transport of refused) {
    await assert.rejects(transport.verify(), (error) => error.statusCode === 403, transport.id);
  }
  const taken = [
    new SparkPostTransport({ apiKey: 'key', retries: 0 }),
    new MailerSendTransport({ apiKey: 'key', retries: 0 }),
    new ScalewayTransport({ secretKey: 'key', projectId: 'p', retries: 0 }),
  ];
  for (const transport of taken) await transport.verify();
});
