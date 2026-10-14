// Ported from upyo v0.7.0 (packages/ses/src/ses-transport.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createMessage } = require('../../src/core/message.js');
const { SesTransport } = require('../../src/ses/index.js');
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('SesTransport constructor creates instance with valid config', () => {
  const config = {
    authentication: {
      type: 'credentials',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    },
  };

  const transport = new SesTransport(config);

  assert.ok(transport instanceof SesTransport);
  assert.equal(transport.config.region, 'us-east-1');
  assert.equal(transport.config.authentication.type, 'credentials');
});

test('SesTransport handles AbortSignal cancellation', async () => {
  const config = {
    authentication: {
      type: 'credentials',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    },
  };

  const transport = new SesTransport(config);
  const controller = new AbortController();
  controller.abort();

  const message = createMessage({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Test Subject',
    content: { text: 'Hello World!' },
  });

  try {
    await transport.send(message, { signal: controller.signal });
    assert.fail('Should have thrown AbortError');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(error.name === 'AbortError' || error.message.includes('abort'));
  }
});

test('SesTransport rejects caller aborts during fetch', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();

  try {
    globalThis.fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          },
          { once: true },
        );
        setTimeout(() => controller.abort(), 0);
      });

    const transport = new SesTransport({
      authentication: {
        type: 'credentials',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
      retries: 0,
    });

    const message = createMessage({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test Subject',
      content: { text: 'Hello World!' },
    });

    await assert.rejects(
      () => transport.send(message, { signal: controller.signal }),
      (error) => error instanceof Error && error.name === 'AbortError',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SesTransport preserves custom caller abort reasons during fetch', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const reason = new Error('Stop fetching.');

  try {
    globalThis.fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            reject(options.signal?.reason);
          },
          { once: true },
        );
        setTimeout(() => controller.abort(reason), 0);
      });

    const transport = new SesTransport({
      authentication: {
        type: 'credentials',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
      retries: 0,
    });

    const message = createMessage({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test Subject',
      content: { text: 'Hello World!' },
    });

    await assert.rejects(
      () => transport.send(message, { signal: controller.signal }),
      (error) => error === reason,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SesTransport rejects caller aborts during retry backoff', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const reason = new Error('Stop retrying.');
  let attempts = 0;

  try {
    globalThis.fetch = async () => {
      attempts++;
      setTimeout(() => controller.abort(reason), 0);
      return new Response('Server Error', { status: 500 });
    };

    const transport = new SesTransport({
      authentication: {
        type: 'credentials',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
      retries: 1,
    });

    const message = createMessage({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test Subject',
      content: { text: 'Hello World!' },
    });

    const startedAt = Date.now();
    await assert.rejects(
      () => transport.send(message, { signal: controller.signal }),
      (error) => error === reason,
    );

    assert.equal(attempts, 1);
    assert.ok(Date.now() - startedAt < 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Upstream's "SesTransport falls back when AbortSignal.any is unavailable" is not
// ported: Node 22 always has AbortSignal.any, and src/core/abort-signal.js keeps
// no fallback for runtimes without it.

test('SesTransport sendMany handles async iterables', async () => {
  const config = {
    authentication: {
      type: 'credentials',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    },
  };

  const transport = new SesTransport(config);

  const messageGenerator = async function* () {
    for (let i = 0; i < 3; i++) {
      yield createMessage({
        from: 'sender@example.com',
        to: `recipient${i}@example.com`,
        subject: `Message ${i}`,
        content: { text: `Hello ${i}!` },
      });
    }
  };

  const controller = new AbortController();
  controller.abort();

  const receipts = [];

  try {
    for await (const receipt of transport.sendMany(messageGenerator(), {
      signal: controller.signal,
    })) {
      receipts.push(receipt);
    }
    assert.fail('Should have thrown AbortError');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(error.name === 'AbortError' || error.message.includes('abort'));
    assert.equal(receipts.length, 0);
  }
});

test('SesTransport sendMany handles sync iterables', async () => {
  const config = {
    authentication: {
      type: 'credentials',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    },
  };

  const transport = new SesTransport(config);

  const messages = [
    createMessage({
      from: 'sender@example.com',
      to: 'recipient1@example.com',
      subject: 'Message 1',
      content: { text: 'Hello 1!' },
    }),
    createMessage({
      from: 'sender@example.com',
      to: 'recipient2@example.com',
      subject: 'Message 2',
      content: { text: 'Hello 2!' },
    }),
  ];

  const controller = new AbortController();
  controller.abort();

  const receipts = [];

  try {
    for await (const receipt of transport.sendMany(messages, {
      signal: controller.signal,
    })) {
      receipts.push(receipt);
    }
    assert.fail('Should have thrown AbortError');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(error.name === 'AbortError' || error.message.includes('abort'));
    assert.equal(receipts.length, 0);
  }
});

test('SesTransport extractMessageId handles JSON response', () => {
  const config = {
    authentication: {
      type: 'credentials',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    },
  };

  const transport = new SesTransport(config);

  const extractMessageId = transport.extractMessageId.bind(transport);

  const response = {
    statusCode: 200,
    body: '{"MessageId":"test-message-id-123"}',
    headers: {},
  };

  const messageId = extractMessageId(response);
  assert.equal(messageId, 'test-message-id-123');
});

test('SesTransport extractMessageId handles header fallback', () => {
  const config = {
    authentication: {
      type: 'credentials',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    },
  };

  const transport = new SesTransport(config);

  const extractMessageId = transport.extractMessageId.bind(transport);

  const response = {
    statusCode: 200,
    body: '',
    headers: { 'x-amzn-requestid': 'header-request-id-456' },
  };

  const messageId = extractMessageId(response);
  assert.equal(messageId, 'header-request-id-456');
});

test('SesTransport extractMessageId generates synthetic ID', () => {
  const config = {
    authentication: {
      type: 'credentials',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    },
  };

  const transport = new SesTransport(config);

  const extractMessageId = transport.extractMessageId.bind(transport);

  const response = {
    statusCode: 200,
    body: '',
    headers: {},
  };

  const messageId = extractMessageId(response);
  assert.ok(messageId.startsWith('ses-'));
  assert.ok(messageId.length > 10);
});

test('SesTransport returns structured API failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Retry-After': '60' },
        }),
      );

    const transport = new SesTransport({
      authentication: {
        type: 'credentials',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
      retries: 0,
    });

    const receipt = await transport.send(
      createMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        content: { text: 'Hello World!' },
      }),
    );

    assert.ok(!receipt.successful);
    if (!receipt.successful) {
      assert.equal(receipt.provider, 'ses');
      assert.ok(receipt.retryable);
      assert.equal(receipt.attempts, 1);
      assert.equal(receipt.errors?.[0]?.category, 'rate-limit');
      assert.equal(receipt.errors?.[0]?.statusCode, 429);
      assert.equal(receipt.errors?.[0]?.retryAfterMilliseconds, 60_000);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SesTransport preserves provider error details', async () => {
  const originalFetch = globalThis.fetch;
  const providerErrors = [
    {
      message: 'Email address is not verified',
      field: 'Destination.ToAddresses.member.1',
      code: 'MessageRejected',
    },
  ];

  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            message: 'Email address is not verified',
            errors: providerErrors,
          }),
          { status: 400 },
        ),
      );

    const transport = new SesTransport({
      authentication: {
        type: 'credentials',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
      retries: 0,
    });

    const receipt = await transport.send(
      createMessage({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        content: { text: 'Hello World!' },
      }),
    );

    assert.ok(!receipt.successful);
    if (!receipt.successful) {
      assert.deepEqual(receipt.errors?.[0]?.providerDetails, providerErrors);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
