// What ./logger adds to the port of @upyo/logtape: the logger is checked when
// the transport is made, and a real pino logger takes the calls as they are.
const { test } = require('node:test');
const assert = require('node:assert');
const { Writable } = require('node:stream');
const pino = require('pino');
const { createMessage } = require('../../index.js');
const { LoggerTransport } = require('../../src/logger/index.js');

const message = () =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });
const methods = (...levels) => Object.fromEntries(levels.map((level) => [level, () => {}]));

test('Logger: a missing logger, an unknown level or a missing method is refused', () => {
  assert.throws(() => new LoggerTransport(), {
    name: 'TypeError',
    message: 'Expected a logger: an object with a method per level, such as a pino logger.',
  });
  assert.throws(() => new LoggerTransport({ logger: 'pino' }), TypeError);
  const logger = methods('debug', 'info', 'error');
  assert.throws(() => new LoggerTransport({ logger, levels: { sent: 'warning' } }), {
    message: 'Expected levels.sent to be one of trace, debug, info, warn, error, fatal: "warning"',
  });
  assert.throws(() => new LoggerTransport({ logger, levels: { failed: 'fatal' } }), {
    message: 'Expected the logger to have a fatal() method for levels.failed.',
  });
  assert.strictEqual(new LoggerTransport({ logger }).id, 'logger');
});

test('Logger: a pino logger records the lifecycle, with the error serialized', async () => {
  const lines = [];
  const destination = new Writable({
    write(chunk, encoding, callback) {
      lines.push(JSON.parse(chunk));
      callback();
    },
  });
  const logger = pino({ level: 'debug', base: undefined, timestamp: false }, destination);
  const error = new TypeError('Connection refused.');
  const base = {
    id: 'base',
    send: async () => {
      throw error;
    },
    async *sendMany() {},
  };
  const transport = new LoggerTransport({ transport: base, logger });
  await assert.rejects(transport.send(message()), error);

  assert.deepStrictEqual(
    lines.map(({ level, msg, event }) => [level, msg, event]),
    [
      [20, 'Sending email.', 'email.sending'],
      [50, 'Failed to send email: TypeError: Connection refused.', 'email.failed'],
    ],
  );
  assert.strictEqual(lines[1].err.type, 'TypeError');
  assert.strictEqual(lines[1].err.message, 'Connection refused.');
  assert.match(lines[1].err.stack, /TypeError: Connection refused\./);
  assert.strictEqual(lines[1].transportId, 'base');
});

test('Logger: unless the message is recorded, a failure is logged without addresses', async () => {
  const failure = {
    successful: false,
    errorMessages: ['RCPT TO failed for bob@example.com: 550 No such user'],
    errors: [
      {
        message: 'RCPT TO failed for bob@example.com: 550 No such user',
        category: 'rejected',
        retryable: false,
        providerDetails: { response: '550 <bob@example.com> No such user' },
      },
    ],
    retryable: false,
  };
  const transport = { id: 'smtp', send: async () => failure, async *sendMany() {} };
  for (const recordMessage of [undefined, 'properties']) {
    const calls = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (properties) => calls.push(properties),
    };
    await new LoggerTransport({ logger, transport, recordMessage }).send(message());
    const logged = JSON.stringify(calls[0]);
    assert.strictEqual(logged.includes('bob@example.com'), recordMessage !== undefined, logged);
    if (recordMessage === undefined) {
      assert.deepStrictEqual(calls[0].errorMessages, [
        'RCPT TO failed for [REDACTED]: 550 No such user',
      ]);
      assert.strictEqual(calls[0].errors[0].providerDetails, undefined);
      assert.strictEqual(calls[0].errors[0].category, 'rejected');
    }
  }
});

test('Logger: a retry of the wrapped transport is logged, and still reaches onRetry', async () => {
  const calls = [];
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (properties, text) => calls.push({ level, text, properties });
  }
  const busy = Object.assign(new Error('Mailbox of bob@example.com is busy'), { statusCode: 503 });
  const base = {
    id: 'base',
    send: async (_message, options) => {
      options.onRetry({ attempt: 1, delayMilliseconds: 250, error: busy });
      return { successful: true, messageId: 'm1' };
    },
    async *sendMany(messages, options) {
      for await (const sent of messages) yield await base.send(sent, options);
    },
  };
  const heard = [];
  const transport = new LoggerTransport({ transport: base, logger });
  await transport.send(message(), { onRetry: (event) => heard.push(event.attempt) });
  for await (const receipt of transport.sendMany([message()])) {
    assert.strictEqual(receipt.successful, true);
  }

  assert.deepStrictEqual(heard, [1]);
  const retries = calls.filter((call) => call.properties.event === 'email.retrying');
  assert.strictEqual(retries.length, 2);
  assert.strictEqual(retries[0].level, 'warn');
  assert.strictEqual(retries[0].text, 'Retrying email.');
  assert.strictEqual(retries[0].properties.operation, 'send');
  assert.strictEqual(retries[0].properties.recipientCount, 1);
  assert.strictEqual(retries[1].properties.operation, 'sendMany');
  assert.strictEqual(retries[1].properties.recipientCount, undefined);
  for (const retry of retries) {
    assert.strictEqual(retry.properties.attempt, 1);
    assert.strictEqual(retry.properties.delayMilliseconds, 250);
    assert.strictEqual(retry.properties.statusCode, 503);
    assert.strictEqual(retry.properties.errorMessage, 'Error: Mailbox of [REDACTED] is busy');
  }

  const minimal = methods('debug', 'info', 'error');
  assert.throws(() => new LoggerTransport({ transport: base, logger: minimal }), {
    message: 'Expected the logger to have a warn() method for levels.retrying.',
  });
  assert.strictEqual(
    new LoggerTransport({ transport: base, logger: minimal, levels: { retrying: 'info' } }).id,
    'base',
  );
});

test('Logger: a logger that throws loses no receipt and stops no send', async (t) => {
  const warnings = t.mock.method(process, 'emitWarning', () => {});
  const broken = () => {
    throw new Error('Log sink is down');
  };
  const logger = { debug: broken, info: broken, warn: broken, error: broken };
  let sent = 0;
  const base = {
    id: 'base',
    send: async () => {
      sent++;
      return { successful: true, messageId: 'm1' };
    },
    async *sendMany(messages) {
      for await (const sentMessage of messages) yield await base.send(sentMessage);
    },
  };
  const transport = new LoggerTransport({ transport: base, logger });
  assert.deepStrictEqual(await transport.send(message()), { successful: true, messageId: 'm1' });
  for await (const receipt of transport.sendMany([message()])) {
    assert.strictEqual(receipt.successful, true);
  }
  assert.strictEqual(sent, 2);
  assert.ok(warnings.mock.callCount() >= 4);
  assert.deepStrictEqual(warnings.mock.calls[0].arguments, [
    'The logger of LoggerTransport threw: Error: Log sink is down',
    { code: 'MAILER_LOGGER_FAILED' },
  ]);
});

test('Logger: generateId makes the message ID of a log-only receipt', async () => {
  const logger = { debug: () => {}, info: () => {}, error: () => {} };
  const transport = new LoggerTransport({ logger, generateId: () => '01JLOG' });
  assert.strictEqual((await transport.send(message())).messageId, 'logger-01JLOG');
});
