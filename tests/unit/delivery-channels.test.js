// Not ported: the delivery matrix of the providers of the channels, the
// contracts of tests/unit/delivery.test.js with a message of each channel: a
// provider that may have taken a request is never sent it again without a
// key, a refused connection is, the wait a provider asks for is read, and
// neither a secret nor the recipient reaches a log.
const { test } = require('node:test');
const assert = require('node:assert');
const { inspect } = require('node:util');
const { channelProviders } = require('../helpers/delivery/channels.js');

// A provider with a key sends an ambiguous request again, under the key.
const expectedRequests = (provider) => (provider.keyed === true ? 2 : 1);

const failed = (code) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });

const unreadable = () =>
  new Response(
    new ReadableStream({
      pull(controller) {
        controller.error(new Error('Connection reset while reading the body.'));
      },
    }),
    { status: 200 },
  );

test('Delivery of the channels: a 2xx with an unreadable body is sent once, of unknown delivery', async (t) => {
  for (const provider of channelProviders) {
    let requests = 0;
    const fetch = async () => {
      requests++;
      return unreadable();
    };
    const receipt = await provider.create({ fetch }).send(provider.message());
    assert.strictEqual(requests, expectedRequests(provider), provider.name);
    assert.strictEqual(receipt.successful, false, provider.name);
    assert.strictEqual(receipt.deliveryUnknown, true, provider.name);
    assert.strictEqual(receipt.retryable, false, provider.name);
    assert.strictEqual(receipt.channel, provider.message().channel, provider.name);
  }
  t.mock.restoreAll();
});

test('Delivery of the channels: a lost request is not sent again without a key; a refused one is', async () => {
  for (const provider of channelProviders) {
    for (const code of ['ECONNRESET', 'ECONNREFUSED']) {
      let requests = 0;
      const fetch = async () => {
        requests++;
        throw failed(code);
      };
      const receipt = await provider.create({ fetch }).send(provider.message());
      if (code === 'ECONNREFUSED') {
        assert.strictEqual(requests, 2, `${provider.name} ${code}`);
        assert.strictEqual(receipt.deliveryUnknown, undefined, `${provider.name} ${code}`);
        assert.strictEqual(receipt.retryable, true, `${provider.name} ${code}`);
      } else {
        assert.strictEqual(requests, expectedRequests(provider), `${provider.name} ${code}`);
        assert.strictEqual(receipt.deliveryUnknown, true, `${provider.name} ${code}`);
      }
    }
  }
});

test('Delivery of the channels: a send that times out is not sent again without a key, of unknown delivery', async () => {
  for (const provider of channelProviders) {
    let requests = 0;
    const fetch = (_url, init) => {
      requests++;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    };
    const receipt = await provider.create({ fetch, timeout: 20 }).send(provider.message());
    assert.strictEqual(requests, expectedRequests(provider), provider.name);
    assert.strictEqual(receipt.deliveryUnknown, true, provider.name);
  }
});

test('Delivery of the channels: the wait a provider asks for is read, and a long one returned', async () => {
  for (const provider of channelProviders) {
    let requests = 0;
    const fetch = async () => {
      requests++;
      return provider.rateLimited(120);
    };
    const receipt = await provider.create({ fetch }).send(provider.message());
    // Beyond half a minute the send does not wait: the queue does.
    assert.strictEqual(requests, 1, provider.name);
    assert.strictEqual(receipt.successful, false, provider.name);
    assert.strictEqual(receipt.retryable, true, provider.name);
    assert.strictEqual(receipt.errors[0].category, 'rate-limit', provider.name);
    assert.strictEqual(receipt.errors[0].retryAfterMilliseconds, 120_000, provider.name);
    const answers = [provider.rateLimited(0), provider.ok()];
    const heard = [];
    const again = await provider
      .create({ fetch: async () => answers.shift() })
      .send(provider.message(), { onRetry: (event) => heard.push(event.attempt) });
    assert.strictEqual(again.successful, true, provider.name);
    assert.deepStrictEqual(heard, [1], provider.name);
  }
});

test('Delivery of the channels: a redirect is not followed, nor retried', async () => {
  for (const provider of channelProviders) {
    const seen = [];
    const fetch = async (url, init) => {
      seen.push(init.redirect);
      return new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } });
    };
    const receipt = await provider.create({ fetch }).send(provider.message());
    assert.deepStrictEqual(seen, ['manual'], provider.name);
    assert.strictEqual(receipt.successful, false, provider.name);
  }
});

test('Delivery of the channels: a provider refuses a plain HTTP URL but to this machine', () => {
  for (const provider of channelProviders) {
    assert.throws(() => provider.create({ baseUrl: 'http://api.example.com' }), TypeError);
    assert.doesNotThrow(() => provider.create({ baseUrl: 'http://127.0.0.1:8081' }));
  }
});

test('Delivery of the channels: a 2xx body longer than 4 MiB is refused, of unknown delivery', async () => {
  for (const provider of channelProviders) {
    const fetch = async () =>
      new Response('x'.repeat(4 * 1024 * 1024 + 1), {
        status: 200,
        headers: { 'Content-Length': String(4 * 1024 * 1024 + 1) },
      });
    const receipt = await provider.create({ fetch }).send(provider.message());
    assert.strictEqual(receipt.successful, false, provider.name);
    assert.strictEqual(receipt.deliveryUnknown, true, provider.name);
  }
});

test('Delivery of the channels: the failure of fetch stays the cause of the error', async () => {
  for (const provider of channelProviders) {
    const fetch = async () => {
      throw failed('ECONNREFUSED');
    };
    const receipt = await provider.create({ fetch, retries: 0 }).send(provider.message());
    assert.strictEqual(receipt.errors[0].category, 'network', provider.name);
  }
});

test('Delivery of the channels: every transport requests through the fetch it is given', async (t) => {
  const global = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('the global fetch');
  });
  for (const provider of channelProviders) {
    let calls = 0;
    const fetch = async () => {
      calls++;
      return provider.ok();
    };
    const receipt = await provider.create({ fetch }).send(provider.message());
    assert.strictEqual(receipt.successful, true, provider.name);
    assert.strictEqual(calls, 1, provider.name);
  }
  assert.strictEqual(global.mock.callCount(), 0);
});

test('Delivery of the channels: no secret or recipient reaches a log, a receipt or an inspection', async () => {
  for (const provider of channelProviders) {
    const records = [];
    const logger = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
      logger[level] = (properties, text) => records.push({ level, properties, text });
    }
    const answers = [new Response('busy', { status: 503 }), provider.ok()];
    const fetch = async () => {
      const next = answers.shift() ?? provider.ok();
      if (next.status === 503) throw failed('ECONNREFUSED');
      return next;
    };
    const transport = provider.create({ fetch, logger });
    const receipt = await transport.send(provider.message());
    const seen = JSON.stringify(records) + JSON.stringify(receipt);
    const shown = JSON.stringify(transport) + inspect(transport, { depth: 5 });
    for (const secret of provider.secrets) {
      assert.ok(!seen.includes(secret), `${provider.name} logs a secret`);
      assert.ok(!shown.includes(secret), `${provider.name} shows a secret`);
    }
    assert.ok(!JSON.stringify(records).includes(provider.recipient), provider.name);
    assert.ok(records.length > 0, provider.name);
  }
});

test('Delivery of the channels: every transport rejects with the reason of an abort, before or during', async () => {
  for (const provider of channelProviders) {
    const seen = { requests: 0 };
    const fetch = (_url, init) => {
      seen.requests++;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    };
    const reason = new Error(`stopped ${provider.name}`);
    const early = new AbortController();
    early.abort(reason);
    await assert.rejects(
      provider.create({ fetch }).send(provider.message(), { signal: early.signal }),
      (error) => error === reason,
    );
    assert.strictEqual(seen.requests, 0, provider.name);
    const late = new AbortController();
    const sending = provider.create({ fetch }).send(provider.message(), { signal: late.signal });
    while (seen.requests === 0) await new Promise((resolve) => setImmediate(resolve));
    late.abort(reason);
    await assert.rejects(sending, (error) => error === reason);
  }
});

test('Delivery of the channels: a transport sends no message of another channel', async () => {
  const { createMessage } = require('../../index.js');
  for (const provider of channelProviders) {
    let requests = 0;
    const fetch = async () => {
      requests++;
      return provider.ok();
    };
    const email = createMessage({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 's',
      content: { text: 't' },
    });
    const receipt = await provider.create({ fetch }).send(email);
    assert.strictEqual(receipt.successful, false, provider.name);
    assert.strictEqual(receipt.errors[0].category, 'unsupported', provider.name);
    assert.strictEqual(requests, 0, provider.name);
  }
});

test('Delivery of the channels: a provider with a key sends a lost request again, the same', async () => {
  for (const provider of channelProviders) {
    if (provider.keyed !== true) continue;
    const bodies = [];
    const fetch = async (_url, init) => {
      bodies.push(
        typeof init.body === 'string' ? init.body : JSON.stringify([...init.body.keys()]),
      );
      if (bodies.length === 1) throw failed('ECONNRESET');
      return provider.ok();
    };
    const receipt = await provider.create({ fetch }).send(provider.message());
    assert.strictEqual(receipt.successful, true, provider.name);
    assert.strictEqual(bodies.length, 2, provider.name);
    assert.strictEqual(bodies[0], bodies[1], provider.name);
  }
});
