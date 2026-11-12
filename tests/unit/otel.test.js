// Paths of the ported OpenTelemetry decorator (src/otel/) that upstream's
// suites leave out: sampled-out spans and metrics, the transport name,
// version and network attributes guessed from a transport's config, custom
// batch attributes and failed batches.
const { test } = require('node:test');
const assert = require('node:assert');
const { OpenTelemetryTransport } = require('../../src/otel/index.js');
const { MockMeterProvider, MockTracerProvider } = require('../helpers/otel/mock-otel-providers.js');
const { createTestMessage, extractSpans } = require('../helpers/otel/test-config.js');

const providers = () => ({
  tracerProvider: new MockTracerProvider(),
  meterProvider: new MockMeterProvider(),
});
const plain = (config, receipt = { successful: true, messageId: 'm1' }) => ({
  config,
  send: async (message) => (typeof receipt === 'function' ? receipt(message) : receipt),
  async *sendMany(messages) {
    for await (const message of messages) {
      yield typeof receipt === 'function' ? receipt(message) : receipt;
    }
  },
});
const outcome = (priority, status) => ({
  'mailer.transport.name': 'unknown',
  'mailer.channel': 'email',
  'mailer.priority': priority,
  'mailer.status': status,
});
const collect = async (iterable) => {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
};

test('OTel: nothing is recorded when sampled out', async () => {
  const { tracerProvider, meterProvider } = providers();
  const options = {
    tracerProvider,
    meterProvider,
    tracing: { samplingRate: 0 },
    metrics: { enabled: false },
    attributeExtractor: () => ({ 'app.custom': true }),
  };
  const ok = new OpenTelemetryTransport(plain({}), options);
  assert.strictEqual((await ok.send(createTestMessage())).successful, true);
  await collect(ok.sendMany([createTestMessage()]));

  const failure = { successful: false, errorMessages: ['Rejected'], errors: [] };
  let index = 0;
  const partial = new OpenTelemetryTransport(
    plain({}, () => (index++ === 0 ? { successful: true, messageId: 'm1' } : failure)),
    options,
  );
  await collect(partial.sendMany([createTestMessage(), createTestMessage()]));
  await collect(
    new OpenTelemetryTransport(plain({}, failure), options).sendMany([createTestMessage()]),
  );

  const throwing = plain({});
  throwing.send = async () => {
    throw new Error('Connection refused');
  };
  await assert.rejects(new OpenTelemetryTransport(throwing, options).send(createTestMessage()));
  assert.deepStrictEqual(tracerProvider.getAllSpans(), []);
});

test('OTel: the transport name and the network attributes come from its config', async () => {
  const cases = [
    [
      { host: 'smtp.example.com', port: 587 },
      'smtp',
      { 'network.protocol.name': 'smtp', 'server.address': 'smtp.example.com', 'server.port': 587 },
    ],
    [
      { domain: 'mg.example.com', region: 'eu' },
      'mailgun',
      { 'server.address': 'api.eu.mailgun.net' },
    ],
    [
      { apiKey: 'k', region: 'us', baseUrl: 'https://api.example.com:8443' },
      'sendgrid',
      { 'network.protocol.name': 'http', 'url.scheme': 'https', 'server.port': 8443 },
    ],
    [{ accessKeyId: 'a', endpoint: 'not a url' }, 'ses', {}],
    [{ version: 3 }, 'unknown', {}],
  ];
  for (const [config, name, network] of cases) {
    const { tracerProvider, meterProvider } = providers();
    const transport = new OpenTelemetryTransport(plain(config), { tracerProvider, meterProvider });
    await transport.send(createTestMessage());
    const [span] = tracerProvider.getAllSpans();
    assert.strictEqual(span.attributes['mailer.transport.name'], name, name);
    for (const [key, value] of Object.entries(network)) {
      assert.strictEqual(span.attributes[key], value, `${name}: ${key}`);
    }
    if ('version' in config) assert.strictEqual(span.attributes['mailer.transport.version'], '3');
  }
});

test('OTel: the network attributes of a transport are not guessed from the shape of its config', async () => {
  // Transports of the application whose config only looks like SMTP's or
  // Mailgun's, or names a URL of another protocol.
  const cases = [
    { id: 'gateway', config: { host: 'gateway.internal', port: 8080 } },
    { id: 'relay', config: { domain: 'example.com', region: 'eu' } },
    { id: 'cache', config: { endpoint: 'redis://cache.internal:6379' } },
  ];
  for (const { id, config } of cases) {
    const { tracerProvider, meterProvider } = providers();
    const transport = new OpenTelemetryTransport(
      { ...plain(config), id },
      { tracerProvider, meterProvider },
    );
    await transport.send(createTestMessage());
    const [span] = tracerProvider.getAllSpans();
    assert.strictEqual(span.attributes['mailer.transport.name'], id);
    for (const key of ['network.protocol.name', 'url.scheme', 'server.address', 'server.port']) {
      assert.strictEqual(span.attributes[key], undefined, `${id}: ${key}`);
    }
  }
  // The SMTP transport is told by its id.
  const { tracerProvider, meterProvider } = providers();
  const smtp = { ...plain({ host: 'smtp.example.com', port: 465 }), id: 'smtp' };
  await new OpenTelemetryTransport(smtp, { tracerProvider, meterProvider }).send(
    createTestMessage(),
  );
  const [span] = tracerProvider.getAllSpans();
  assert.strictEqual(span.attributes['network.protocol.name'], 'smtp');
  assert.strictEqual(span.attributes['server.port'], 465);
});

test('OTel: a batch gets the custom attributes and records its failures', async () => {
  const { tracerProvider, meterProvider } = providers();
  const failure = { successful: false, errorMessages: ['Rejected'], errors: [] };
  const transport = new OpenTelemetryTransport(plain({}, failure), {
    tracerProvider,
    meterProvider,
    attributeExtractor: (operation, transportName, count) => ({
      'app.operation': operation,
      'app.count': count,
    }),
  });
  const receipts = await collect(transport.sendMany([createTestMessage(), createTestMessage()]));
  assert.strictEqual(receipts.length, 2);
  const [span] = tracerProvider.getAllSpans();
  assert.strictEqual(span.attributes['app.operation'], 'send_batch');
  assert.strictEqual(span.attributes['app.count'], 2);
  assert.strictEqual(span.status.code, 2);
});

test('OTel: without sensitive data, error text in spans names no address', async () => {
  const rejection = 'RCPT TO failed for bob@example.com: 550 No such user';
  const failure = { successful: false, errorMessages: [rejection], errors: [] };
  const thrown = plain({});
  thrown.send = async () => {
    throw new Error(rejection);
  };
  for (const [transport, recordSensitiveData] of [
    [plain({}, failure), false],
    [thrown, false],
    [plain({}, failure), true],
  ]) {
    const { tracerProvider, meterProvider } = providers();
    const otel = new OpenTelemetryTransport(transport, {
      tracerProvider,
      meterProvider,
      tracing: { recordSensitiveData },
    });
    await otel.send(createTestMessage()).catch(() => {});
    const [span] = tracerProvider.getAllSpans();
    const recorded = JSON.stringify({ status: span.status, events: span.events });
    assert.strictEqual(recorded.includes('bob@example.com'), recordSensitiveData, recorded);
    if (!recordSensitiveData) assert.match(recorded, /RCPT TO failed for \[REDACTED\]: 550/);
  }
});

test('OTel: metrics are recorded for every operation, and only spans are sampled', async () => {
  const { tracerProvider, meterProvider } = providers();
  const transport = new OpenTelemetryTransport(plain({}), {
    tracerProvider,
    meterProvider,
    tracing: { samplingRate: 0 },
  });
  for (let i = 0; i < 20; i++) await transport.send(createTestMessage());
  assert.deepStrictEqual(tracerProvider.getAllSpans(), []);
  const attempts = meterProvider.getAllRecords().find((metric) => metric.instrument === 'counter');
  assert.strictEqual(attempts.records.length, 20);

  assert.throws(
    () =>
      new OpenTelemetryTransport(plain({}), {
        tracerProvider,
        meterProvider,
        metrics: { samplingRate: 0.5 },
      }),
    { name: 'TypeError', message: /metrics\.samplingRate is not supported/ },
  );
});

test('OTel: active sends return to zero however a send or a batch ends', async () => {
  const { tracerProvider, meterProvider } = providers();
  const failing = plain({});
  failing.send = async () => {
    throw new Error('Connection refused');
  };
  failing.sendMany = async function* () {
    yield { successful: true, messageId: 'm1' };
    throw new Error('Connection reset');
  };
  const ok = new OpenTelemetryTransport(plain({}), { tracerProvider, meterProvider });
  const broken = new OpenTelemetryTransport(failing, { tracerProvider, meterProvider });

  await ok.send(createTestMessage());
  await collect(ok.sendMany([createTestMessage(), createTestMessage()]));
  for await (const receipt of ok.sendMany([createTestMessage(), createTestMessage()])) {
    assert.strictEqual(receipt.successful, true);
    break;
  }
  await assert.rejects(broken.send(createTestMessage()));
  await assert.rejects(collect(broken.sendMany([createTestMessage()])));

  const active = meterProvider.getAllRecords().filter((metric) => {
    return metric.instrument === 'upDownCounter';
  });
  let sum = 0;
  let changes = 0;
  for (const metric of active) {
    for (const record of metric.records) {
      sum += record.value;
      changes++;
    }
  }
  assert.strictEqual(changes, 10);
  assert.strictEqual(sum, 0);
});

test('OTel: a message is counted once, with its priority and its outcome', async () => {
  const { tracerProvider, meterProvider } = providers();
  const failure = { successful: false, errorMessages: ['Rejected'], errors: [] };
  const transport = new OpenTelemetryTransport(
    plain({}, (message) =>
      message.priority === 'low' ? failure : { successful: true, messageId: 'm1' },
    ),
    { tracerProvider, meterProvider },
  );
  await transport.send(createTestMessage({ priority: 'high' }));
  await collect(
    transport.sendMany([
      createTestMessage({ priority: 'normal' }),
      createTestMessage({ priority: 'low' }),
    ]),
  );
  const messages = meterProvider
    .getAllRecords()
    .find((metric) => metric.name === 'mailer.message.messages');
  assert.deepStrictEqual(messages.records, [
    { value: 1, attributes: outcome('high', 'success') },
    { value: 1, attributes: outcome('normal', 'success') },
    { value: 1, attributes: outcome('low', 'failure') },
  ]);
});

test('OTel: a batch is a success, a partial failure or a failure', async () => {
  const failure = { successful: false, errorMessages: ['Rejected'], errors: [] };
  const sent = { successful: true, messageId: 'm1' };
  const cases = [
    [[sent, sent], 'success'],
    [[sent, failure], 'partial_failure'],
    [[failure, failure], 'failure'],
  ];
  for (const [receipts, status] of cases) {
    const { tracerProvider, meterProvider } = providers();
    let index = 0;
    const transport = new OpenTelemetryTransport(
      plain({}, () => receipts[index++]),
      { tracerProvider, meterProvider },
    );
    await collect(transport.sendMany([createTestMessage(), createTestMessage()]));
    const attempts = meterProvider
      .getAllRecords()
      .find((metric) => metric.name === 'mailer.message.attempts');
    assert.strictEqual(attempts.records.length, 1);
    assert.strictEqual(attempts.records[0].attributes['mailer.status'], status);
  }
});

test('OTel: the duration buckets reach the histogram as advice', () => {
  for (const [metrics, buckets] of [
    [{}, [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0]],
    [{ durationBuckets: [0.5, 2] }, [0.5, 2]],
  ]) {
    const { tracerProvider, meterProvider } = providers();
    // oxlint-disable-next-line no-new -- the instruments are made by the constructor
    new OpenTelemetryTransport(plain({}), { tracerProvider, meterProvider, metrics });
    const duration = meterProvider
      .getAllRecords()
      .find((metric) => metric.name === 'mailer.message.duration');
    assert.deepStrictEqual(duration.options.advice, { explicitBucketBoundaries: buckets });
  }
});

test('OTel: the default classifier reads words and status codes whole', () => {
  const { defaultErrorClassifier } = require('../../src/otel/index.js');
  const cases = [
    ['Author unknown', 'unknown'],
    ['timeout after 5000ms', 'timeout'],
    ['Message size 4013 octets exceeds the limit', 'unknown'],
    ['HTTP 403 Forbidden', 'auth'],
  ];
  for (const [text, category] of cases) {
    assert.strictEqual(defaultErrorClassifier(new Error(text)), category, text);
  }
});

test('OTel: sendMany passes the messages on as they come', async () => {
  const { tracerProvider, meterProvider } = providers();
  let produced = 0;
  const messages = async function* () {
    while (produced < 1000) {
      produced++;
      yield createTestMessage({ recipients: [{ address: 'bob@example.com' }] });
    }
  };
  const transport = new OpenTelemetryTransport(plain({}), { tracerProvider, meterProvider });
  let received = 0;
  for await (const receipt of transport.sendMany(messages())) {
    assert.strictEqual(receipt.successful, true);
    if (++received === 3) break;
  }
  assert.ok(produced <= 4, `read ${produced} messages for 3 receipts`);
  const [span] = tracerProvider.getAllSpans();
  assert.strictEqual(span.attributes['email.batch.size'], 3);
  assert.strictEqual(span.attributes['email.batch.total_recipients'], 3);
  assert.strictEqual(span.ended, true);
});

test('OTel: a failed batch keeps its first error messages and counts them all', async () => {
  const { tracerProvider, meterProvider } = providers();
  let index = 0;
  const transport = new OpenTelemetryTransport(
    plain({}, () => ({ successful: false, errorMessages: [`Rejected ${index++}`], errors: [] })),
    { tracerProvider, meterProvider },
  );
  const batch = [];
  for (let i = 0; i < 25; i++) batch.push(createTestMessage());
  await collect(transport.sendMany(batch));
  const [span] = tracerProvider.getAllSpans();
  const failed = span.events.find((event) => event.name === 'email.send_failed');
  assert.strictEqual(failed.attributes['error.count'], 25);
  assert.strictEqual(JSON.parse(failed.attributes['error.messages']).length, 10);
  assert.strictEqual(span.attributes['email.error.count'], 25);
});

test('OTel: the errors of a failed batch are redacted of the recipient of their message', async () => {
  // Before (C41): a batch span had no message, so an error naming a chat id
  // or a push token was recorded raw, where the span of a send redacts it.
  const { createChannelMessage } = require('../../src/channels/index.js');
  const { tracerProvider, meterProvider } = providers();
  const transport = new OpenTelemetryTransport(
    plain({}, (message) => ({
      successful: false,
      errorMessages: [`Telegram refused chat ${message.to}`],
      errors: [],
    })),
    { tracerProvider, meterProvider },
  );
  await collect(
    transport.sendMany([
      createChannelMessage({ channel: 'telegram', to: -1001234567890, text: 'a' }),
      createChannelMessage({ channel: 'telegram', to: -1009876543210, text: 'b' }),
    ]),
  );
  const [span] = tracerProvider.getAllSpans();
  const failed = span.events.find((event) => event.name === 'message.send_failed');
  assert.deepStrictEqual(JSON.parse(failed.attributes['error.messages']), [
    'Telegram refused chat [REDACTED]',
    'Telegram refused chat [REDACTED]',
  ]);
});

test('OTel: the retries of the wrapped transport reach the span, the metrics and onRetry', async () => {
  const busy = Object.assign(new Error('Service Unavailable'), { statusCode: 503 });
  const retrying = plain({});
  retrying.send = async (_message, options) => {
    options.onRetry({ attempt: 1, delayMilliseconds: 10, error: busy });
    options.onRetry({ attempt: 2, delayMilliseconds: 20, error: busy });
    return { successful: true, messageId: 'm1' };
  };
  retrying.sendMany = async function* (messages, options) {
    for await (const message of messages) yield await retrying.send(message, options);
  };
  const { tracerProvider, meterProvider } = providers();
  const transport = new OpenTelemetryTransport(retrying, { tracerProvider, meterProvider });
  const heard = [];
  const onRetry = (event) => heard.push(event.attempt);
  await transport.send(createTestMessage(), { onRetry });
  await collect(transport.sendMany([createTestMessage()], { onRetry }));

  assert.deepStrictEqual(heard, [1, 2, 1, 2]);
  for (const span of tracerProvider.getAllSpans()) {
    assert.strictEqual(span.attributes['mailer.retry.count'], 2);
    const retries = span.events.filter((event) => event.name === 'retry');
    assert.deepStrictEqual(
      retries.map((event) => event.attributes),
      [
        { 'retry.attempt': 1, 'retry.reason': 'service-unavailable' },
        { 'retry.attempt': 2, 'retry.reason': 'service-unavailable' },
      ],
    );
  }
  const retries = meterProvider
    .getAllRecords()
    .find((metric) => metric.name === 'mailer.message.retries');
  assert.strictEqual(retries.records.length, 4);
  assert.deepStrictEqual(retries.records[0].attributes, {
    'mailer.transport.name': 'unknown',
    'mailer.channel': 'email',
    'error.type': 'service-unavailable',
  });

  // A span sampled out records nothing, and the retries still reach onRetry.
  const unsampled = providers();
  heard.length = 0;
  await new OpenTelemetryTransport(retrying, {
    ...unsampled,
    tracing: { samplingRate: 0 },
  }).send(createTestMessage(), { onRetry });
  assert.deepStrictEqual(heard, [1, 2]);
  assert.deepStrictEqual(unsampled.tracerProvider.getAllSpans(), []);
});

test('OTel: a safe-looking error message is recorded without its addresses', async () => {
  const thrown = plain({});
  thrown.send = async () => {
    throw new Error('Connection refused by mx for bob@example.com');
  };
  for (const recordSensitiveData of [false, true]) {
    const { tracerProvider, meterProvider } = providers();
    const transport = new OpenTelemetryTransport(thrown, {
      tracerProvider,
      meterProvider,
      tracing: { recordSensitiveData },
    });
    await assert.rejects(transport.send(createTestMessage()));
    const [span] = tracerProvider.getAllSpans();
    assert.strictEqual(
      span.attributes['error.message'],
      recordSensitiveData
        ? 'Connection refused by mx for bob@example.com'
        : 'Connection refused by mx for [REDACTED]',
    );
  }
});

test('OTel: the instruments are named after the semantic conventions', () => {
  const { tracerProvider, meterProvider } = providers();
  // oxlint-disable-next-line no-new -- the instruments are made by the constructor
  new OpenTelemetryTransport(plain({}), {
    tracerProvider,
    meterProvider,
    metrics: { prefix: 'billing' },
  });
  const instruments = [];
  for (const metric of meterProvider.getAllRecords()) {
    instruments.push(`${metric.instrument} ${metric.name} ${metric.options.unit}`);
  }
  assert.deepStrictEqual(instruments.sort(), [
    'counter billing.message.attempts {attempt}',
    'counter billing.message.messages {message}',
    'counter billing.message.retries {retry}',
    'histogram billing.message.attachments {attachment}',
    'histogram billing.message.duration s',
    'histogram billing.message.segments {segment}',
    'histogram billing.message.size By',
    'upDownCounter billing.message.active_sends {send}',
  ]);
});

test('OTel: an exception event carries the stack, its message redacted', async () => {
  for (const recordSensitiveData of [false, true]) {
    const thrown = plain({});
    thrown.send = async () => {
      throw new Error('Connection refused for bob@example.com');
    };
    const { tracerProvider, meterProvider } = providers();
    const transport = new OpenTelemetryTransport(thrown, {
      tracerProvider,
      meterProvider,
      tracing: { recordSensitiveData },
    });
    await assert.rejects(transport.send(createTestMessage()));
    const [span] = tracerProvider.getAllSpans();
    const exception = span.events.find((event) => event.name === 'exception');
    const stacktrace = exception.attributes['exception.stacktrace'];
    const address = recordSensitiveData ? 'bob@example.com' : '[REDACTED]';
    assert.ok(stacktrace.startsWith(`Error: Connection refused for ${address}\n`), stacktrace);
    assert.match(stacktrace, /\n {4}at /);
  }
});

test('OTel: random decides which operations get a span', async () => {
  for (const [value, spans] of [
    [0.9, 0],
    [0.1, 1],
  ]) {
    const { tracerProvider, meterProvider } = providers();
    const transport = new OpenTelemetryTransport(plain({}), {
      tracerProvider,
      meterProvider,
      tracing: { samplingRate: 0.5 },
      random: () => value,
    });
    await transport.send(createTestMessage());
    assert.strictEqual(tracerProvider.getAllSpans().length, spans);
  }
});

test('OTel: a failure of unknown delivery is told apart, on the span and the counter', async () => {
  // Before: it was a failure like any other, though it is the one to
  // reconcile from the provider's events rather than to send again.
  const unknown = {
    successful: false,
    errorMessages: ['The connection closed after the end of DATA.'],
    errors: [{ message: 'lost', category: 'network', retryable: false }],
    deliveryUnknown: true,
  };
  const otel = providers();
  const transport = new OpenTelemetryTransport(plain({}, unknown), otel);
  await transport.send(createTestMessage());
  for await (const receipt of transport.sendMany([createTestMessage()])) assert.ok(receipt);
  const spans = extractSpans(otel.tracerProvider);
  assert.strictEqual(spans.length, 2);
  for (const span of spans) assert.strictEqual(span.attributes['mailer.delivery_unknown'], true);
  const counted = [];
  for (const metric of otel.meterProvider.getAllRecords()) {
    if (metric.name !== 'mailer.message.messages') continue;
    for (const record of metric.records) counted.push(record.attributes['mailer.delivery_unknown']);
  }
  assert.deepStrictEqual(counted, [true, true]);
});

test('OTel: the message counter takes the category and the code of a failure', async () => {
  // Before: a failed message was counted as a failure alone, so a rate
  // limit, a refused key and a refusal of the provider could not be told
  // apart without the traces.
  const limited = {
    successful: false,
    errorMessages: ['Too many requests.'],
    errors: [{ message: 'limited', category: 'rate-limit', code: 'http.429', retryable: true }],
  };
  const otel = providers();
  const transport = new OpenTelemetryTransport(plain({}, limited), otel);
  await transport.send(createTestMessage());
  const counted = [];
  for (const metric of otel.meterProvider.getAllRecords()) {
    if (metric.name !== 'mailer.message.messages') continue;
    for (const record of metric.records) {
      counted.push([record.attributes['error.type'], record.attributes['mailer.error.code']]);
    }
  }
  assert.deepStrictEqual(counted, [['rate-limit', 'http.429']]);
});

test('OTel: a message of a channel has a span and metrics of its channel, not its recipient', async () => {
  const { createChannelMessage } = require('../../src/channels/index.js');
  const sms = createChannelMessage({
    channel: 'sms',
    to: '+380671234567',
    from: 'Alexis',
    text: 'Код: 1234',
    tenantId: 'acme',
    priority: 'high',
  });
  const telegram = createChannelMessage({ channel: 'telegram', to: 987654321, text: 'Hi' });
  for (const recordSensitiveData of [false, true]) {
    const { tracerProvider, meterProvider } = providers();
    const transport = new OpenTelemetryTransport(
      plain({}, (message) =>
        message.channel === 'sms'
          ? { successful: true, messageId: 'SM1', segments: 1, state: 'accepted' }
          : {
              successful: false,
              errorMessages: ['Forbidden: bot was blocked by the user 987654321'],
              errors: [{ message: 'blocked', category: 'blocked' }],
              retryable: false,
            },
      ),
      { tracerProvider, meterProvider, tracing: { recordSensitiveData } },
    );
    // Before: the size of a message read its subject and threw.
    assert.strictEqual((await transport.send(sms)).successful, true);
    assert.strictEqual((await transport.send(telegram)).successful, false);
    const [sent, failed] = tracerProvider.getAllSpans();
    // The mock span holds its name and kind among its attributes.
    const { 'span.name': name, 'span.kind': _kind, ...attributes } = sent.attributes;
    assert.strictEqual(name, 'sms send');
    assert.deepStrictEqual(attributes, {
      'operation.name': 'sms.send',
      'operation.type': 'sms',
      'mailer.channel': 'sms',
      'mailer.priority': 'high',
      'mailer.message.tags': '[]',
      'mailer.message.text.length': 9,
      'mailer.message.media.count': 0,
      'mailer.message.size': 12,
      'mailer.transport.name': 'unknown',
      'mailer.retry.count': 0,
      'mailer.batch.size': 1,
      'mailer.message.segments': 1,
      'mailer.message.encoding': 'UCS-2',
      ...(recordSensitiveData && { 'mailer.message.from': 'Alexis' }),
      'mailer.tenant.id': 'acme',
      'mailer.message.id': 'SM1',
    });
    assert.deepStrictEqual(
      sent.events.map((event) => event.name),
      ['message.sent'],
    );
    assert.strictEqual(failed.attributes['span.name'], 'telegram send');
    assert.deepStrictEqual(
      failed.events.map((event) => event.name),
      ['message.send_failed'],
    );
    assert.strictEqual(failed.attributes['mailer.error.count'], 1);
    // The chat id, which no rule of addresses or numbers finds, is redacted.
    assert.strictEqual(
      failed.status.message,
      recordSensitiveData
        ? 'Forbidden: bot was blocked by the user 987654321'
        : 'Forbidden: bot was blocked by the user [REDACTED]',
    );
    assert.ok(!JSON.stringify(sent.attributes).includes('380671234567'));

    const metric = (instrument) =>
      meterProvider
        .getAllRecords()
        .find((record) => record.name === `mailer.message.${instrument}`);
    assert.deepStrictEqual(
      metric('messages').records.map((record) => record.attributes),
      [
        {
          'mailer.transport.name': 'unknown',
          'mailer.channel': 'sms',
          'mailer.priority': 'high',
          'mailer.status': 'success',
          // The state the provider took it in; delivery comes in its events.
          'mailer.message.state': 'accepted',
        },
        {
          'mailer.transport.name': 'unknown',
          'mailer.channel': 'telegram',
          'mailer.priority': 'normal',
          'mailer.status': 'failure',
          'error.type': 'blocked',
        },
      ],
    );
    assert.deepStrictEqual(metric('segments').records, [
      { value: 1, attributes: { 'mailer.transport.name': 'unknown', 'mailer.channel': 'sms' } },
    ]);
    assert.deepStrictEqual(
      metric('size').records.map((record) => [record.value, record.attributes['mailer.channel']]),
      [
        [12, 'sms'],
        [2, 'telegram'],
      ],
    );
    assert.deepStrictEqual(
      metric('attempts').records.map((record) => record.attributes['mailer.channel']),
      ['sms', 'telegram'],
    );
    const active = metric('active_sends').records;
    assert.strictEqual(active.length, 4);
    assert.strictEqual(active[0].attributes['mailer.channel'], 'sms');
  }
});

test('OTel: a batch is named and measured by the channel its messages share', async () => {
  const { createChannelMessage } = require('../../src/channels/index.js');
  const sms = (text) => createChannelMessage({ channel: 'sms', to: '+380671234567', text });
  const telegram = createChannelMessage({ channel: 'telegram', to: 42, text: 'Hi' });
  const run = async (messages, tracing = {}) => {
    const { tracerProvider, meterProvider } = providers();
    const transport = new OpenTelemetryTransport(plain({}), {
      tracerProvider,
      meterProvider,
      tracing,
    });
    await collect(transport.sendMany(messages));
    const [span] = tracerProvider.getAllSpans();
    const attempt = meterProvider
      .getAllRecords()
      .find((record) => record.name === 'mailer.message.attempts').records[0];
    return { span, attempt };
  };
  const shared = await run([sms('a'), sms('b')]);
  assert.strictEqual(shared.span.attributes['span.name'], 'sms send_batch');
  assert.strictEqual(shared.span.attributes['operation.name'], 'sms.send_batch');
  assert.strictEqual(shared.span.attributes['mailer.channel'], 'sms');
  assert.strictEqual(shared.span.attributes['mailer.batch.total_recipients'], 2);
  assert.deepStrictEqual(
    shared.span.events.map((event) => event.name),
    ['message.sent'],
  );
  assert.strictEqual(shared.attempt.attributes['mailer.channel'], 'sms');

  const mixed = await run([sms('a'), telegram, createTestMessage()]);
  assert.strictEqual(mixed.span.attributes['span.name'], 'message send_batch');
  assert.strictEqual(mixed.span.attributes['operation.name'], 'message.send_batch');
  assert.strictEqual('mailer.channel' in mixed.span.attributes, false);
  assert.strictEqual('mailer.channel' in mixed.attempt.attributes, false);

  // A batch of email keeps its name, and a prefix names every span.
  const email = await run([createTestMessage()]);
  assert.strictEqual(email.span.attributes['span.name'], 'email send_batch');
  assert.strictEqual(email.span.attributes['mailer.channel'], 'email');
  assert.strictEqual(email.attempt.attributes['mailer.channel'], 'email');
  const prefixed = await run([sms('a')], { spanPrefix: 'notify' });
  assert.strictEqual(prefixed.span.attributes['span.name'], 'notify send_batch');
});

test('OTel: the id of a message of a channel is recorded without the recipient it names', async () => {
  // Before: Telegram's id, `<chat>:<message>`, went whole into mailer.message.id.
  const { createChannelMessage } = require('../../src/channels/index.js');
  const telegram = createChannelMessage({ channel: 'telegram', to: 987654321, text: 'Hi' });
  for (const recordSensitiveData of [false, true]) {
    const { tracerProvider, meterProvider } = providers();
    const transport = new OpenTelemetryTransport(
      plain({}, { successful: true, messageId: '987654321:42' }),
      { tracerProvider, meterProvider, tracing: { recordSensitiveData } },
    );
    await transport.send(telegram);
    const [span] = tracerProvider.getAllSpans();
    assert.strictEqual(
      span.attributes['mailer.message.id'],
      recordSensitiveData ? '987654321:42' : '[REDACTED]:42',
    );
  }
});
