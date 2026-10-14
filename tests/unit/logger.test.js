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
