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
  send: async () => receipt,
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
    metrics: { samplingRate: 0 },
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
