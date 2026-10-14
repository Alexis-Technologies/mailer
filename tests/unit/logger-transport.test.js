// Ported from upyo v0.7.0 (packages/logtape/src/logtape-transport.test.ts), adapted
// to ./logger: a recording pino-like logger replaces LogTape's recorder, the
// message is the rendered text (no LogTape template), an error is under `err`,
// and the levels are pino's.
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');
const { createFailedReceipt } = require('../../src/core/receipt.js');
const { createMessage } = require('../../src/core/message.js');
const { LoggerTransport } = require('../../src/logger/logger-transport.js');

const message = createMessage({
  from: 'sender@example.com',
  to: ['first@example.net', 'second@example.net'],
  cc: 'copy@example.net',
  bcc: 'blind-copy@example.net',
  subject: 'Test message',
  content: { text: 'Hello from Upyo.' },
  priority: 'high',
  attachments: [
    {
      inline: false,
      filename: 'hello.txt',
      contentType: 'text/plain',
      content: new TextEncoder().encode('Hello.'),
      contentId: 'hello@example.com',
    },
  ],
});
// The type-level checks of upstream (a provider id needs a wrapped transport,
// recordMessage is not a boolean) are in tests/types/logger.test-d.ts.

describe('LoggerTransport', () => {
  it('logs standalone sends and returns a synthetic receipt', async () => {
    await withRecorder(async (recorder) => {
      const transport = new LoggerTransport({ logger: recorder.logger });
      const typedTransport = transport;

      const receipt = await typedTransport.send(message);

      assert.ok(receipt.successful);
      assert.match(receipt.messageId, /^logger-[0-9a-f-]+$/);
      assert.equal(receipt.provider, 'logger');
      assert.equal(receipt.attempts, 1);
      assert.ok(receipt.timestamp != null);
      assert.equal(transport.id, 'logger');
      assert.equal(transport.config.recordMessage, false);
      assert.equal(recorder.records.length, 2);
      recorder.assertLogged({
        level: 'debug',
        message: 'Sending email.',
        properties: {
          event: 'email.sending',
          operation: 'send',
          transportId: 'logger',
          recipientCount: 2,
          ccRecipientCount: 1,
          bccRecipientCount: 1,
          attachmentCount: 1,
          priority: 'high',
        },
      });
      recorder.assertLogged({
        level: 'info',
        message: 'Email sent.',
        properties: {
          event: 'email.sent',
          operation: 'send',
          transportId: 'logger',
          messageId: receipt.messageId,
          provider: 'logger',
        },
      });
      assert.ok(recorder.records.every((record) => !('message' in record.properties)));
    });
  });

  it('supports custom categories, levels, and full message recording', async () => {
    await withRecorder(async (recorder) => {
      const transport = new LoggerTransport({
        logger: recorder.logger,
        recordMessage: 'properties',
        levels: {
          sending: 'trace',
          sent: 'warn',
          failed: 'fatal',
        },
      });

      await transport.send(message);

      recorder.assertLogged({
        level: 'trace',
        message: 'Sending email.',
        properties: { event: 'email.sending', message },
      });
      recorder.assertLogged({
        level: 'warn',
        message: 'Email sent.',
        properties: { event: 'email.sent', message },
      });
    });
  });

  it('renders message subjects and text content inline', async () => {
    await withRecorder(async (recorder) => {
      const transport = new LoggerTransport({
        logger: recorder.logger,
        recordMessage: 'inline',
      });

      await transport.send(message);

      recorder.assertLogged({
        message: /^Sending email\.\n\nSubject: Test message\n\nHello from Upyo\.$/,
        properties: { event: 'email.sending', message },
      });
      recorder.assertLogged({
        message: /^Email sent\.\n\nSubject: Test message\n\nHello from Upyo\.$/,
        properties: { event: 'email.sent', message },
      });
    });
  });

  it('renders failed receipts inline', async () => {
    await withRecorder(async (recorder) => {
      const base = new RecordingTransport();
      base.nextReceipt = createFailedReceipt('Provider rejected the message.', {
        provider: 'base',
        category: 'rejected',
        code: 'base.rejected',
        retryable: false,
      });
      const transport = new LoggerTransport({
        logger: recorder.logger,
        transport: base,
        recordMessage: 'inline',
      });

      await transport.send(message);

      recorder.assertLogged({
        message: /^Failed to send email\.\n\nSubject: Test message\n\nHello from Upyo\.$/,
        properties: { event: 'email.failed', message },
      });
    });
  });

  it('uses HTML inline only when plain text is undefined', async () => {
    await withRecorder(async (recorder) => {
      const transport = new LoggerTransport({
        logger: recorder.logger,
        recordMessage: 'inline',
      });
      const htmlMessage = createMessage({
        from: 'sender@example.com',
        to: 'recipient@example.net',
        subject: 'HTML message',
        content: { html: '<p>Hello from HTML.</p>', text: undefined },
      });
      const alternativeMessage = createMessage({
        from: 'sender@example.com',
        to: 'recipient@example.net',
        subject: 'Alternative message',
        content: { html: '<p>HTML alternative.</p>', text: '' },
      });

      await transport.send(htmlMessage);
      await transport.send(alternativeMessage);

      recorder.assertLogged({
        message: /^Email sent\.\n\nSubject: HTML message\n\n<p>Hello from HTML\.<\/p>$/,
        properties: { event: 'email.sent', message: htmlMessage },
      });
      recorder.assertLogged({
        message: /^Email sent\.\n\nSubject: Alternative message\n\n$/,
        properties: { event: 'email.sent', message: alternativeMessage },
      });
    });
  });

  it('decorates a transport without changing successful receipts', async () => {
    await withRecorder(async (recorder) => {
      const base = new RecordingTransport();
      const transport = new LoggerTransport({
        logger: recorder.logger,
        transport: base,
      });
      const typedTransport = transport;
      const controller = new AbortController();

      const receipt = await typedTransport.send(message, {
        signal: controller.signal,
      });

      assert.deepEqual(receipt, {
        successful: true,
        messageId: 'base-message-1',
        provider: 'base',
      });
      assert.equal(transport.id, 'base');
      assert.deepEqual(base.sentMessages, [message]);
      assert.equal(base.lastOptions?.signal, controller.signal);
      recorder.assertLogged({
        level: 'info',
        properties: {
          event: 'email.sent',
          transportId: 'base',
          messageId: 'base-message-1',
          provider: 'base',
        },
      });
    });
  });

  it('logs and preserves failed receipts', async () => {
    await withRecorder(async (recorder) => {
      const base = new RecordingTransport();
      base.nextReceipt = createFailedReceipt('Provider rejected the message.', {
        provider: 'base',
        category: 'rejected',
        code: 'base.rejected',
        retryable: false,
      });
      const transport = new LoggerTransport({
        logger: recorder.logger,
        transport: base,
        levels: { failed: 'fatal' },
      });

      const receipt = await transport.send(message);

      assert.ok(!receipt.successful);
      assert.deepEqual(receipt.errorMessages, ['Provider rejected the message.']);
      recorder.assertLogged({
        level: 'fatal',
        message: 'Failed to send email.',
        properties: {
          event: 'email.failed',
          operation: 'send',
          transportId: 'base',
          errorMessages: receipt.errorMessages,
          retryable: false,
          provider: 'base',
        },
      });
    });
  });

  it('logs thrown errors and rethrows the original value', async () => {
    await withRecorder(async (recorder) => {
      const base = new RecordingTransport();
      const error = new TypeError('Transport failed.');
      base.throwError = error;
      const transport = new LoggerTransport({
        logger: recorder.logger,
        transport: base,
      });

      let thrown;
      try {
        await transport.send(message);
      } catch (caught) {
        thrown = caught;
      }

      assert.equal(thrown, error);
      recorder.assertLogged({
        level: 'error',
        message: /Failed to send email/,
        properties: {
          event: 'email.failed',
          operation: 'send',
          transportId: 'base',
          err: error,
        },
      });
    });
  });

  it('delegates sendMany while logging each message and receipt', async () => {
    await withRecorder(async (recorder) => {
      const base = new RecordingTransport();
      const transport = new LoggerTransport({
        logger: recorder.logger,
        transport: base,
        recordMessage: 'inline',
      });
      const secondMessage = createMessage({
        from: 'sender@example.com',
        to: 'third@example.net',
        subject: 'Second message',
        content: { text: 'Another message.' },
      });
      const messages = async function* () {
        yield message;
        yield secondMessage;
      };

      const receipts = [];
      for await (const receipt of transport.sendMany(messages())) {
        receipts.push(receipt);
      }

      assert.equal(base.sendManyCalls, 1);
      assert.equal(base.sendCalls, 0);
      assert.deepEqual(base.sentMessages, [message, secondMessage]);
      assert.deepEqual(
        receipts.map((receipt) => receipt.successful && receipt.messageId),
        ['base-batch-1', 'base-batch-2'],
      );
      assert.equal(recorder.filter({ properties: { event: 'email.sending' } }).length, 2);
      assert.equal(recorder.filter({ properties: { event: 'email.sent' } }).length, 2);
      assert.ok(recorder.records.every((record) => record.properties.operation === 'sendMany'));
      assert.deepEqual(
        recorder.records.map((record) => record.properties.message),
        [message, message, secondMessage, secondMessage],
      );
      recorder.assertLogged({
        message: /^Sending email\.\n\nSubject: Test message\n\nHello from Upyo\.$/,
        properties: { event: 'email.sending', message },
      });
      recorder.assertLogged({
        message: /^Email sent\.\n\nSubject: Test message\n\nHello from Upyo\.$/,
        properties: { event: 'email.sent', message },
      });
      recorder.assertLogged({
        message: /^Sending email\.\n\nSubject: Second message\n\nAnother message\.$/,
        properties: { event: 'email.sending', message: secondMessage },
      });
      recorder.assertLogged({
        message: /^Email sent\.\n\nSubject: Second message\n\nAnother message\.$/,
        properties: { event: 'email.sent', message: secondMessage },
      });
    });
  });

  it('closes buffered receipts when the sendMany consumer stops early', async () => {
    await withRecorder(async (recorder) => {
      const secondMessage = createMessage({
        from: 'sender@example.com',
        to: 'third@example.net',
        subject: 'Second message',
        content: { text: 'Another message.' },
      });
      const base = new BufferedTransport();
      const transport = new LoggerTransport({
        logger: recorder.logger,
        transport: base,
      });

      // oxlint-disable-next-line no-underscore-dangle, no-unused-vars -- upstream
      for await (const _receipt of transport.sendMany([message, secondMessage])) {
        break;
      }

      assert.deepEqual(base.sentMessages, [message, secondMessage]);
      assert.equal(base.yieldedReceiptCount, 1);
      assert.equal(recorder.filter({ properties: { event: 'email.sent' } }).length, 1);
    });
  });

  it('does not send more messages when a sequential consumer stops early', async () => {
    await withRecorder(async (recorder) => {
      const secondMessage = createMessage({
        from: 'sender@example.com',
        to: 'third@example.net',
        subject: 'Second message',
        content: { text: 'Another message.' },
      });
      const base = new RecordingTransport();
      const transport = new LoggerTransport({
        logger: recorder.logger,
        transport: base,
      });

      // oxlint-disable-next-line no-underscore-dangle, no-unused-vars -- upstream
      for await (const _receipt of transport.sendMany([message, secondMessage])) {
        break;
      }

      assert.deepEqual(base.sentMessages, [message]);
      assert.equal(recorder.filter({ properties: { event: 'email.sent' } }).length, 1);
    });
  });

  it('does not advance a prefetched batch after its consumer stops', async () => {
    await withRecorder(async (recorder) => {
      const secondMessage = createMessage({
        from: 'sender@example.com',
        to: 'third@example.net',
        subject: 'Second message',
        content: { text: 'Another message.' },
      });
      const thirdMessage = createMessage({
        from: 'sender@example.com',
        to: 'fourth@example.net',
        subject: 'Third message',
        content: { text: 'One more message.' },
      });
      const base = new PrefetchingTransport();
      const transport = new LoggerTransport({
        logger: recorder.logger,
        transport: base,
      });

      // oxlint-disable-next-line no-underscore-dangle, no-unused-vars -- upstream
      for await (const _receipt of transport.sendMany([message, secondMessage, thirdMessage])) {
        break;
      }

      assert.deepEqual(base.sentMessages, [message, secondMessage]);
      assert.ok(base.closed);
    });
  });

  it('logs every pending message when sendMany throws', async () => {
    await withRecorder(async (recorder) => {
      const secondMessage = createMessage({
        from: 'sender@example.com',
        to: 'third@example.net',
        subject: 'Second message',
        content: { text: 'Another message.' },
      });
      const error = new TypeError('Batch transport failed.');
      const base = new ConsumingThenThrowingTransport(error);
      const transport = new LoggerTransport({
        logger: recorder.logger,
        transport: base,
        recordMessage: 'inline',
      });

      let thrown;
      try {
        // oxlint-disable-next-line no-underscore-dangle, no-unused-vars -- upstream
        for await (const _receipt of transport.sendMany([message, secondMessage])) {
          // The wrapped transport throws before yielding a receipt.
        }
      } catch (caught) {
        thrown = caught;
      }

      assert.equal(thrown, error);
      assert.deepEqual(base.sentMessages, [message, secondMessage]);
      const failures = recorder.filter({
        properties: { event: 'email.failed' },
      });
      assert.equal(failures.length, 2);
      assert.deepEqual(
        failures.map((record) => record.properties.message),
        [message, secondMessage],
      );
      assert.deepEqual(
        failures.map((record) => record.properties.recipientCount),
        [2, 1],
      );
      assert.ok(failures.every((record) => record.properties.err === error));
      recorder.assertLogged({
        message:
          /^Failed to send email: TypeError: Batch transport failed\.[\s\S]*\n\nSubject: Test message\n\nHello from Upyo\.$/,
        properties: { event: 'email.failed', message },
      });
      recorder.assertLogged({
        message:
          /^Failed to send email: TypeError: Batch transport failed\.[\s\S]*\n\nSubject: Second message\n\nAnother message\.$/,
        properties: { event: 'email.failed', message: secondMessage },
      });
    });
  });

  it('keeps batch errors without a message on one line', async () => {
    await withRecorder(async (recorder) => {
      const error = new TypeError('Batch transport failed before consuming.');
      const base = new RecordingTransport();
      const transport = new LoggerTransport({
        logger: recorder.logger,
        transport: base,
        recordMessage: 'inline',
      });
      const messages = {
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.reject(error),
          };
        },
      };

      await assert.rejects(async () => {
        // oxlint-disable-next-line no-underscore-dangle, no-unused-vars -- upstream
        for await (const _receipt of transport.sendMany(messages)) {
          // The wrapped transport throws before yielding a receipt.
        }
      }, error);

      recorder.assertLogged({
        message: /^Failed to send email: TypeError: Batch transport failed before consuming\./,
        properties: (properties) =>
          properties.event === 'email.failed' && !('message' in properties),
      });
    });
  });

  it('handles synchronous sendMany input in log-only mode', async () => {
    await withRecorder(async (recorder) => {
      const transport = new LoggerTransport({ logger: recorder.logger });
      const secondMessage = createMessage({
        from: 'sender@example.com',
        to: 'third@example.net',
        subject: 'Second message',
        content: { text: 'Another message.' },
      });

      const receipts = [];
      for await (const receipt of transport.sendMany([message, secondMessage])) {
        receipts.push(receipt);
      }

      assert.equal(receipts.length, 2);
      assert.ok(receipts.every((receipt) => receipt.successful));
      assert.notEqual(
        receipts[0].successful && receipts[0].messageId,
        receipts[1].successful && receipts[1].messageId,
      );
      assert.equal(recorder.filter({ properties: { operation: 'sendMany' } }).length, 4);
    });
  });

  it('rejects an already aborted standalone send without logging', async () => {
    await withRecorder(async (recorder) => {
      const controller = new AbortController();
      controller.abort();
      const transport = new LoggerTransport({ logger: recorder.logger });

      await assert.rejects(() => transport.send(message, { signal: controller.signal }), {
        name: 'AbortError',
      });
      assert.equal(recorder.records.length, 0);
    });
  });

  it('disposes an asynchronous wrapped transport', async () => {
    const base = new AsyncDisposableTransport();
    const transport = new LoggerTransport({
      logger: createRecorder().logger,
      transport: base,
    });

    await transport[Symbol.asyncDispose]();

    assert.ok(base.disposed);
  });

  it('falls back to disposing a synchronous wrapped transport', async () => {
    const base = new DisposableTransport();
    const transport = new LoggerTransport({
      logger: createRecorder().logger,
      transport: base,
    });

    await transport[Symbol.asyncDispose]();

    assert.ok(base.disposed);
  });
});

// A pino-like logger that records each call, and the matching LogTape's
// recorder offered: assertLogged() and filter() over level, message and
// properties (a partial object, or a predicate).
function createRecorder() {
  const records = [];
  const logger = {};
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
    // oxlint-disable-next-line no-shadow -- upstream
    logger[level] = (properties, message) => records.push({ level, message, properties });
  }
  const matches = (record, expected) => {
    if (expected.level !== undefined && record.level !== expected.level) return false;
    if (typeof expected.message === 'string' && record.message !== expected.message) return false;
    if (expected.message instanceof RegExp && !expected.message.test(record.message)) {
      return false;
    }
    if (typeof expected.properties === 'function') return expected.properties(record.properties);
    for (const [key, value] of Object.entries(expected.properties ?? {})) {
      try {
        assert.deepEqual(record.properties[key], value);
      } catch {
        return false;
      }
    }
    return true;
  };
  return {
    logger,
    records,
    filter: (expected) => records.filter((record) => matches(record, expected)),
    assertLogged(expected) {
      assert.ok(
        records.some((record) => matches(record, expected)),
        `No record matches ${JSON.stringify(expected)}`,
      );
    },
  };
}

async function withRecorder(run) {
  await run(createRecorder());
}

class RecordingTransport {
  id = 'base';
  sentMessages = [];
  sendCalls = 0;
  sendManyCalls = 0;
  lastOptions;
  nextReceipt = {
    successful: true,
    messageId: 'base-message-1',
    provider: 'base',
  };
  throwError;

  // oxlint-disable-next-line no-shadow -- upstream
  send(message, options) {
    this.sendCalls++;
    this.sentMessages.push(message);
    this.lastOptions = options;
    if (this.throwError != null) return Promise.reject(this.throwError);
    return Promise.resolve(this.nextReceipt);
  }

  async *sendMany(messages, options) {
    this.sendManyCalls++;
    this.lastOptions = options;
    let index = 0;
    // oxlint-disable-next-line no-shadow -- upstream
    for await (const message of messages) {
      this.sentMessages.push(message);
      if (this.throwError != null) throw this.throwError;
      yield {
        successful: true,
        messageId: `base-batch-${++index}`,
        provider: 'base',
      };
    }
  }
}

class AsyncDisposableTransport extends RecordingTransport {
  disposed = false;

  [Symbol.asyncDispose]() {
    this.disposed = true;
    return Promise.resolve();
  }
}

class DisposableTransport extends RecordingTransport {
  disposed = false;

  [Symbol.dispose]() {
    this.disposed = true;
  }
}

class ConsumingThenThrowingTransport {
  id = 'base';
  sentMessages = [];

  error;

  constructor(error) {
    this.error = error;
  }

  send() {
    return Promise.reject(this.error);
  }

  async *sendMany(messages) {
    // oxlint-disable-next-line no-shadow -- upstream
    for await (const message of messages) {
      this.sentMessages.push(message);
    }
    yield* [];
    throw this.error;
  }
}

class BufferedTransport {
  id = 'base';
  sentMessages = [];
  yieldedReceiptCount = 0;

  send() {
    return Promise.reject(new TypeError('Use sendMany().'));
  }

  async *sendMany(messages) {
    // oxlint-disable-next-line no-shadow -- upstream
    for await (const message of messages) {
      this.sentMessages.push(message);
    }
    for (let index = 0; index < this.sentMessages.length; index++) {
      this.yieldedReceiptCount++;
      yield {
        successful: true,
        messageId: `base-buffered-${index + 1}`,
        provider: 'base',
      };
    }
  }
}

class PrefetchingTransport {
  id = 'base';
  sentMessages = [];
  closed = false;

  send() {
    return Promise.reject(new TypeError('Use sendMany().'));
  }

  async *sendMany(messages) {
    try {
      const iterator =
        Symbol.asyncIterator in messages
          ? messages[Symbol.asyncIterator]()
          : messages[Symbol.iterator]();
      const first = await iterator.next();
      const second = await iterator.next();
      if (first.done || second.done) return;
      this.sentMessages.push(first.value, second.value);

      yield {
        successful: true,
        messageId: 'base-prefetched-1',
        provider: 'base',
      };

      const third = await iterator.next();
      if (!third.done) this.sentMessages.push(third.value);
      yield {
        successful: true,
        messageId: 'base-prefetched-2',
        provider: 'base',
      };
    } finally {
      this.closed = true;
    }
  }
}
