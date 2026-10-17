// Not ported: `sendRaw()` and `verify()` through every decorator, which
// upstream forwarded through none, and raw MIME on SES and Mailgun.
const { test } = require('node:test');
const assert = require('node:assert');
const PostalMime = require('postal-mime');
const { isRawTransport, isVerifiableTransport } = require('../../index.js');
const { RetryTransport } = require('../../src/retry/index.js');
const { PoolTransport } = require('../../src/pool/index.js');
const { OpenTelemetryTransport } = require('../../src/otel/index.js');
const { LoggerTransport } = require('../../src/logger/index.js');
const { MockTransport } = require('../../src/mock/index.js');
const { SesTransport } = require('../../src/ses/index.js');
const { MailgunTransport } = require('../../src/mailgun/index.js');
const { MockMeterProvider, MockTracerProvider } = require('../helpers/otel/mock-otel-providers.js');

const encoder = new TextEncoder();
const raw = (to = ['bob@example.com']) => ({
  envelope: { from: 'alex@bücher.de', to },
  content: encoder.encode(
    'From: alex@example.com\r\nTo: bob@example.com\r\nSubject: Raw\r\n\r\nHello\r\n',
  ),
});
// A transport that composes every message itself: no sendRaw, no verify.
const plain = (id = 'plain') => ({
  id,
  send: async () => ({ successful: true, messageId: 'p', provider: id }),
  async *sendMany() {},
});
const failure = (retryable) => ({
  successful: false,
  errorMessages: ['busy'],
  errors: [{ message: 'busy', category: 'server-error', code: 'x', retryable }],
  retryable,
});
const off = { tracing: { enabled: false }, metrics: { enabled: false } };
const assertRefused = (receipt, id) => {
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.retryable, false);
  assert.strictEqual(receipt.errors[0].category, 'configuration');
  assert.strictEqual(receipt.errorMessages[0], `The transport ${id} does not send raw messages.`);
};

test('Raw: every decorator and the mock send raw messages and verify', () => {
  const mock = new MockTransport();
  const decorators = [
    new RetryTransport(mock),
    new PoolTransport({ strategy: 'priority', transports: [{ transport: mock }] }),
    new OpenTelemetryTransport(mock, { tracing: { enabled: false }, metrics: { enabled: false } }),
    new LoggerTransport({
      transport: mock,
      logger: { info() {}, debug() {}, warn() {}, error() {} },
    }),
    mock,
    new SesTransport({
      authentication: { type: 'credentials', accessKeyId: 'a', secretAccessKey: 's' },
    }),
    new MailgunTransport({ apiKey: 'k', domain: 'mg.example.com' }),
  ];
  for (const transport of decorators) assert.ok(isRawTransport(transport), transport.id);
  for (const transport of decorators.slice(0, 5)) {
    assert.ok(isVerifiableTransport(transport), transport.id);
  }
});

test('Raw: the mock keeps raw messages apart, and verify resolves', async () => {
  const mock = new MockTransport();
  const receipt = await mock.sendRaw(raw());
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(mock.getSentRawMessages().length, 1);
  assert.strictEqual(mock.getSentMessagesCount(), 0);
  await mock.verify();
  mock.clearSentMessages();
  assert.strictEqual(mock.getSentRawMessages().length, 0);
  const aborted = new AbortController();
  aborted.abort(new Error('stop'));
  await assert.rejects(mock.verify({ signal: aborted.signal }), /stop/);
  await assert.rejects(mock.sendRaw(raw(), { signal: aborted.signal }), /stop/);
});

test('Raw: retry retries a raw message as a message, and verifies once', async () => {
  const mock = new MockTransport();
  mock.setNextResponse(failure(true));
  const retry = new RetryTransport(mock, {
    maxAttempts: 3,
    backoff: { baseDelayMilliseconds: 1, maxDelayMilliseconds: 1 },
  });
  const receipt = await retry.sendRaw(raw());
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(receipt.attempts, 2);
  assert.strictEqual(mock.getSentRawMessages().length, 2);
  assertRefused(await new RetryTransport(plain()).sendRaw(raw()), 'plain');
  let verified = 0;
  const verifiable = { ...plain(), verify: async () => verified++ };
  await new RetryTransport(verifiable).verify();
  await new RetryTransport(plain()).verify();
  assert.strictEqual(verified, 1);
});

test('Raw: the pool sends through the transports that can, failing over among them', async () => {
  const first = new MockTransport();
  first.setNextResponse(failure(true));
  const second = new MockTransport();
  let asked = 0;
  const pool = new PoolTransport({
    strategy: 'priority',
    transports: [
      { transport: plain(), priority: 3 },
      { transport: first, priority: 2, selector: () => asked++ > -1 },
      { transport: second, priority: 1 },
    ],
  });
  const receipt = await pool.sendRaw(raw());
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(first.getSentRawMessages().length, 1);
  assert.strictEqual(second.getSentRawMessages().length, 1);
  assert.strictEqual(asked, 0);
  const none = new PoolTransport({ strategy: 'priority', transports: [{ transport: plain() }] });
  assertRefused(await none.sendRaw(raw()), 'pool');
  const disabled = new PoolTransport({
    strategy: 'priority',
    transports: [{ transport: new MockTransport(), enabled: false }, { transport: plain() }],
  });
  assertRefused(await disabled.sendRaw(raw()), 'pool');
});

test('Raw: the pool verifies when one transport verifies', async () => {
  const fails = (text) => ({ ...plain(), verify: async () => Promise.reject(new Error(text)) });
  const passes = { ...plain(), verify: async () => {} };
  const pool = (...transports) =>
    new PoolTransport({
      strategy: 'priority',
      transports: transports.map((transport) => ({ transport })),
    });
  await pool(fails('down'), passes).verify();
  await pool(plain()).verify();
  await assert.rejects(pool(fails('a'), fails('b')).verify(), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepStrictEqual(
      error.errors.map((each) => each.message),
      ['a', 'b'],
    );
    return true;
  });
  const aborted = new AbortController();
  aborted.abort(new Error('stop'));
  await assert.rejects(pool(passes).verify({ signal: aborted.signal }), /stop/);
});

test('Raw: OpenTelemetry records a raw send in a span of its own', async () => {
  const tracerProvider = new MockTracerProvider();
  const meterProvider = new MockMeterProvider();
  const mock = new MockTransport();
  const otel = new OpenTelemetryTransport(mock, {
    tracerProvider,
    meterProvider,
    tracing: { enabled: true },
    metrics: { enabled: true },
  });
  const receipt = await otel.sendRaw(raw(['b@example.com', 'c@example.com']));
  assert.strictEqual(receipt.successful, true);
  const span = tracerProvider.getAllSpans().at(-1);
  assert.strictEqual(span.name, 'email send_raw');
  assert.strictEqual(span.attributes['operation.name'], 'email.send_raw');
  assert.strictEqual(span.attributes['email.to.count'], 2);
  assert.strictEqual(span.attributes['email.from.domain'], 'bücher.de');
  assert.strictEqual(span.attributes['email.from.address'], undefined);
  assert.ok(span.attributes['email.message.size'] > 0);
  assertRefused(await new OpenTelemetryTransport(plain(), off).sendRaw(raw()), 'plain');
  await otel.verify();
  await new OpenTelemetryTransport(plain(), off).verify();
});

test('Raw: the logger logs a raw send by its envelope, addresses only when asked', async () => {
  const records = [];
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (properties, text) => records.push({ level, properties, text });
  }
  const mock = new MockTransport();
  const transport = new LoggerTransport({ transport: mock, logger, recordMessage: false });
  const receipt = await transport.sendRaw(raw(['b@example.com', 'c@example.com']));
  assert.strictEqual(receipt.successful, true);
  assert.deepStrictEqual(
    records.map((record) => [record.properties.event, record.properties.recipientCount]),
    [
      ['email.sending', 2],
      ['email.sent', 2],
    ],
  );
  assert.strictEqual(records[0].properties.envelope, undefined);
  assert.strictEqual(records[0].properties.operation, 'sendRaw');
  records.length = 0;
  await new LoggerTransport({ transport: mock, logger, recordMessage: 'inline' }).sendRaw(raw());
  assert.deepStrictEqual(records[0].properties.envelope.to, ['bob@example.com']);
  assert.strictEqual(records[0].text, 'Sending email.');
  records.length = 0;
  assertRefused(await new LoggerTransport({ transport: plain(), logger }).sendRaw(raw()), 'plain');
  assert.strictEqual(records.at(-1).properties.event, 'email.failed');
  const logOnly = await new LoggerTransport({ logger }).sendRaw(raw());
  assert.strictEqual(logOnly.successful, true);
  await new LoggerTransport({ logger }).verify();
  await new LoggerTransport({ transport: mock, logger }).verify();
});

test('Raw: SES sends a raw message as Raw content, to its envelope', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(init.body) });
    return Response.json({ MessageId: 'ses-1' });
  });
  const ses = new SesTransport({
    authentication: { type: 'credentials', accessKeyId: 'a', secretAccessKey: 's' },
    configurationSetName: 'tracking',
    defaultTags: { app: 'test' },
    retries: 0,
  });
  const receipt = await ses.sendRaw(raw(['b@example.com', 'c@пример.рф']));
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.strictEqual(receipt.messageId, 'ses-1');
  const { body, url } = requests[0];
  assert.match(url, /\/v2\/email\/outbound-emails$/);
  assert.deepStrictEqual(body.Destination, {
    ToAddresses: ['b@example.com', 'c@xn--e1afmkfd.xn--p1ai'],
  });
  assert.strictEqual(body.FromEmailAddress, 'alex@xn--bcher-kva.de');
  assert.strictEqual(body.ConfigurationSetName, 'tracking');
  assert.deepStrictEqual(body.Tags, [{ Name: 'app', Value: 'test' }]);
  const parsed = await PostalMime.parse(Buffer.from(body.Content.Raw.Data, 'base64'));
  assert.strictEqual(parsed.subject, 'Raw');
  const invalid = await ses.sendRaw({
    envelope: { from: null, to: ['b@example.com'] },
    content: encoder.encode('Subject: x\r\n\r\nbare\rcr\r\n'),
  });
  assert.strictEqual(invalid.successful, false);
  assert.strictEqual(invalid.errors[0].category, 'validation');
  assert.strictEqual(requests.length, 1);
  const nullSender = await ses.sendRaw({
    ...raw(),
    envelope: { from: null, to: ['b@example.com'] },
  });
  assert.strictEqual(nullSender.successful, true);
  assert.strictEqual(requests[1].body.FromEmailAddress, undefined);
});

test('Raw: Mailgun sends a raw message to messages.mime', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    requests.push({ url: String(input), form: init.body });
    return Response.json({ id: '<mg-1@mg.example.com>', message: 'Queued' });
  });
  const mailgun = new MailgunTransport({ apiKey: 'k', domain: 'mg.example.com', retries: 0 });
  const receipt = await mailgun.sendRaw(raw(['b@example.com', 'c@example.com']));
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.strictEqual(receipt.messageId, '<mg-1@mg.example.com>');
  assert.match(requests[0].url, /\/v3\/mg\.example\.com\/messages\.mime$/);
  assert.deepStrictEqual(requests[0].form.getAll('to'), ['b@example.com', 'c@example.com']);
  const file = requests[0].form.get('message');
  assert.strictEqual(file.name, 'message.mime');
  assert.match(await file.text(), /^From: alex@example\.com\r\n/);
  const aborted = new AbortController();
  aborted.abort(new Error('stop'));
  await assert.rejects(mailgun.sendRaw(raw(), { signal: aborted.signal }), /stop/);
  const invalid = await mailgun.sendRaw({
    envelope: { from: null, to: [] },
    content: new Uint8Array(),
  });
  assert.strictEqual(invalid.errors[0].category, 'validation');
});
