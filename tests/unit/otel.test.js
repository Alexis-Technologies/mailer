// Paths of the ported OpenTelemetry decorator (src/otel/) that upstream's
// suites leave out: sampled-out spans and metrics, the transport name,
// version and network attributes guessed from a transport's config, custom
// batch attributes and failed batches.
const { test } = require('node:test');
const assert = require('node:assert');
const { OpenTelemetryTransport } = require('../../src/otel/index.js');
const { MockMeterProvider, MockTracerProvider } = require('../helpers/otel/mock-otel-providers.js');
const { createTestMessage } = require('../helpers/otel/test-config.js');

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
      { 'server.address': 'smtp.example.com', 'server.port': 587 },
    ],
    [
      { domain: 'mg.example.com', region: 'eu' },
      'mailgun',
      { 'server.address': 'api.eu.mailgun.net' },
    ],
    [
      { apiKey: 'k', region: 'us', baseUrl: 'https://api.example.com:8443' },
      'sendgrid',
      { 'server.port': 8443 },
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
    .find((metric) => metric.name === 'mailer_email_messages_total');
  assert.deepStrictEqual(messages.records, [
    { value: 1, attributes: { transport: 'unknown', priority: 'high', status: 'success' } },
    { value: 1, attributes: { transport: 'unknown', priority: 'normal', status: 'success' } },
    { value: 1, attributes: { transport: 'unknown', priority: 'low', status: 'failure' } },
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
      .find((metric) => metric.name === 'mailer_email_attempts_total');
    assert.strictEqual(attempts.records.length, 1);
    assert.strictEqual(attempts.records[0].attributes.status, status);
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
      .find((metric) => metric.name === 'mailer_email_duration_seconds');
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
