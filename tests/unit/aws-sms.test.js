// Not ported: tests of ./aws-sms against a stubbed fetch: the request of
// SendTextMessage of AWS End User Messaging SMS, its signature, the
// categories of its errors and its receipts.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { AwsSmsTransport } = require('../../src/aws-sms/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const NOW = Date.parse('2026-11-08T10:00:00Z');
const CREDENTIALS = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-key' };
const transport = (config = {}) =>
  new AwsSmsTransport({
    credentials: CREDENTIALS,
    region: 'eu-west-1',
    retries: 0,
    now: () => NOW,
    ...config,
  });
const sms = (fields = {}) =>
  createChannelMessage({
    channel: 'sms',
    to: '+380671234567',
    text: 'Your code is 1234',
    ...fields,
  });
const awsError = (type, reason, status = 400) =>
  json(
    { __type: type, Message: `${type} ${reason ?? ''}`.trim(), ...(reason && { Reason: reason }) },
    status,
  );

test('AWS SMS: an SMS is SendTextMessage of the JSON protocol, signed with SigV4', async (t) => {
  const requests = stubFetch(t, () => json({ MessageId: 'msg-1' }));
  const receipt = await transport({
    originationIdentity: 'MyBrand',
    configurationSetName: 'otp',
  }).send(
    sms({
      priority: 'low',
      expiresAt: new Date(NOW + 300_000),
      metadata: { correlationId: 'c-1', a: '1' },
    }),
  );
  const [request] = requests;
  assert.strictEqual(request.url, 'https://sms-voice.eu-west-1.amazonaws.com/');
  assert.strictEqual(request.headers.get('x-amz-target'), 'PinpointSMSVoiceV2.SendTextMessage');
  assert.strictEqual(request.headers.get('content-type'), 'application/x-amz-json-1.0');
  assert.match(
    request.headers.get('authorization'),
    /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/eu-west-1\/sms-voice\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
  assert.deepStrictEqual(JSON.parse(request.body), {
    DestinationPhoneNumber: '+380671234567',
    MessageBody: 'Your code is 1234',
    OriginationIdentity: 'MyBrand',
    MessageType: 'PROMOTIONAL',
    ConfigurationSetName: 'otp',
    TimeToLive: 300,
    Context: { correlationId: 'c-1', a: '1' },
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: 'msg-1',
    provider: 'aws-sms',
    channel: 'sms',
    state: 'accepted',
    segments: 1,
  });
});

test('AWS SMS: the sender, the type and the context of a message, and a session token', async (t) => {
  const requests = stubFetch(t, () => json({ MessageId: 'msg-1' }));
  let asked = 0;
  const roles = transport({
    credentials: async () => {
      asked++;
      return { ...CREDENTIALS, sessionToken: 'session-token' };
    },
    messageType: 'PROMOTIONAL',
  });
  const metadata = { correlationId: 'c', b: '2', c: '3', d: '4', e: '5', f: '6' };
  await roles.send(sms({ from: '+15550001111', priority: 'high', metadata }));
  await roles.send(sms({ expiresAt: new Date(NOW + 10 * 86_400_000) }));
  assert.strictEqual(asked, 2, 'the credentials are asked for at each attempt');
  assert.strictEqual(requests[0].headers.get('x-amz-security-token'), 'session-token');
  const first = JSON.parse(requests[0].body);
  assert.strictEqual(first.OriginationIdentity, '+15550001111');
  assert.strictEqual(first.MessageType, 'TRANSACTIONAL');
  assert.deepStrictEqual(Object.keys(first.Context), ['correlationId', 'b', 'c', 'd', 'e']);
  const second = JSON.parse(requests[1].body);
  assert.strictEqual(second.MessageType, 'PROMOTIONAL');
  assert.strictEqual(second.TimeToLive, 259200);
});

test('AWS SMS: the context holds only what AWS takes of the metadata', async (t) => {
  // Before (C26): an empty value, a value with a space at an end, or one of
  // 1001 to 1024 characters went into Context, and AWS refused the SMS.
  const requests = stubFetch(t, () => json({ MessageId: 'msg-1' }));
  await transport().send(
    sms({
      metadata: {
        correlationId: 'c-1',
        empty: '',
        padded: ' x ',
        long: 'x'.repeat(1001),
        [`k${'x'.repeat(100)}`]: 'v',
        kept: 'yes',
      },
    }),
  );
  assert.deepStrictEqual(JSON.parse(requests[0].body).Context, {
    correlationId: 'c-1',
    kept: 'yes',
  });
});

test('AWS SMS: an error is told by its reason, then its type', async (t) => {
  const cases = [
    [awsError('ConflictException', 'DESTINATION_PHONE_NUMBER_OPTED_OUT'), 'opted-out', false],
    [
      awsError('ValidationException', 'DESTINATION_PHONE_NUMBER_NOT_VERIFIED'),
      'configuration',
      false,
    ],
    [awsError('ValidationException', 'DESTINATION_COUNTRY_BLOCKED'), 'configuration', false],
    [awsError('ValidationException', 'INVALID_PHONE_NUMBER'), 'invalid-recipient', false],
    [
      awsError('ServiceQuotaExceededException', 'MONTHLY_SPEND_LIMIT_REACHED_FOR_TEXT', 402),
      'configuration',
      false,
    ],
    [awsError('ValidationException', 'OTHER'), 'validation', false],
    [awsError('AccessDeniedException', undefined, 403), 'auth', false],
    [
      awsError('com.amazonaws.sms#ResourceNotFoundException', undefined, 404),
      'configuration',
      false,
    ],
    [awsError('ThrottlingException', undefined, 400), 'rate-limit', true],
    [awsError('InternalServerException', undefined, 500), 'server-error', true],
  ];
  for (const [answer, category, retryable] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => answer.clone());
    const receipt = await transport().send(sms());
    assert.strictEqual(receipt.errors[0].category, category, category);
    assert.strictEqual(receipt.retryable, retryable, category);
  }
  // The type may come in a header alone.
  t.mock.restoreAll();
  stubFetch(
    t,
    () =>
      new Response('', {
        status: 400,
        headers: { 'x-amzn-ErrorType': 'ThrottlingException:http://internal' },
      }),
  );
  assert.strictEqual((await transport().send(sms())).errors[0].category, 'rate-limit');
});

test('AWS SMS: a lost answer is not sent again, and no MessageId is of unknown delivery', async (t) => {
  const requests = stubFetch(t, () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    });
  });
  const receipt = await transport({ retries: 3 }).send(sms());
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(receipt.deliveryUnknown, true);
  t.mock.restoreAll();
  stubFetch(t, () => json({}));
  assert.strictEqual((await transport().send(sms())).deliveryUnknown, true);
});

test('AWS SMS: what the API would refuse fails before any request', async (t) => {
  const requests = stubFetch(t, () => json({ MessageId: 'x' }));
  const cases = [
    [sms({ text: 'x'.repeat(1601) }), 'validation', /more than 1600/],
    [sms({ text: undefined, payload: {} }), 'validation', /needs a text/],
    [sms({ media: [{ url: 'https://example.com/a.png' }] }), 'unsupported', /SendMediaMessage/],
    [
      sms({ buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }] }),
      'unsupported',
      /no buttons/,
    ],
    [sms({ payload: { MessageBody: 'other' } }), 'validation', /cannot set MessageBody/],
    [
      createChannelMessage({ channel: 'whatsapp', to: '+380671234567', text: 'x' }),
      'unsupported',
      /not messages of whatsapp/,
    ],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport().send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.strictEqual(requests.length, 0);
});

test('AWS SMS: a provider of credentials that hangs or fails sends nothing, of no unknown delivery', async (t) => {
  // Before (C5): the credentials were awaited without the signal of the
  // attempt, so one that never answered held the send past its timeout and
  // the caller's abort; and one that threw left the receipt of unknown
  // delivery, though no request was made.
  const requests = stubFetch(t, () => json({ MessageId: 'msg-1' }));
  const hung = transport({ credentials: () => new Promise(() => {}), timeout: 30 });
  const started = Date.now();
  const receipt = await hung.send(sms());
  assert.ok(Date.now() - started < 1000, 'ended with its attempt');
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.deliveryUnknown, undefined);
  const controller = new AbortController();
  const aborted = transport({ credentials: () => new Promise(() => {}), timeout: 0 }).send(sms(), {
    signal: controller.signal,
  });
  controller.abort(new Error('stop'));
  await assert.rejects(aborted, /stop/);
  const failing = await transport({
    credentials: async () => {
      throw new Error('Could not load credentials from any providers');
    },
  }).send(sms());
  assert.strictEqual(failing.deliveryUnknown, undefined);
  assert.match(failing.errorMessages[0], /Could not load credentials/);
  assert.strictEqual(requests.length, 0);
});

test('AWS SMS: the options are checked when made, the secret never shown', () => {
  assert.throws(() => new AwsSmsTransport({}), /needs credentials/);
  assert.throws(() => transport({ region: 'evil.example/' }), /Invalid AWS region/);
  assert.throws(() => transport({ messageType: 'OTP' }), /TRANSACTIONAL/);
  assert.ok(!JSON.stringify(transport()).includes('secret-key'));
});

test('AWS SMS: verify describes the configuration sets, a refused key fails it', async (t) => {
  const requests = stubFetch(t, () => json({ ConfigurationSets: [] }));
  await transport().verify();
  assert.strictEqual(
    requests[0].headers.get('x-amz-target'),
    'PinpointSMSVoiceV2.DescribeConfigurationSets',
  );
  t.mock.restoreAll();
  stubFetch(t, () => awsError('UnrecognizedClientException', undefined, 403));
  await assert.rejects(transport().verify(), (error) => error.statusCode === 403);
});
