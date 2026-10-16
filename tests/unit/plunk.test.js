// Paths of the ported Plunk transport (src/plunk/) that upstream's suites
// leave out, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { PlunkTransport } = require('../../src/plunk/index.js');

const message = (extra = {}) =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
    ...extra,
  });
const config = { apiKey: 'key', retries: 0 };
const send = async (t, respond, options = config, extra) => {
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', respond);
  return new PlunkTransport(options).send(message(extra));
};

test('Plunk: a malformed response body fails the send', async (t) => {
  const cases = [
    [() => Response.json(null), 'Invalid response format: expected object'],
    [() => Response.json({}), 'Invalid response format: missing success field'],
    [() => Response.json({ success: false }), 'Send operation failed without error details'],
    [() => Response.json({ success: false, message: 'Nope' }), 'Nope'],
    [
      () => Response.json({ success: true, data: null }),
      'Invalid response format: missing data field',
    ],
    [() => new Response('<html>'), 'Invalid JSON response from Plunk API'],
  ];
  for (const [respond, expected] of cases) {
    const receipt = await send(t, async () => respond());
    assert.deepStrictEqual(receipt.errorMessages, [expected]);
  }
});

test('Plunk: an unreadable error body and the timeout fail the send', async (t) => {
  const unreadable = await send(
    t,
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('broken'));
          },
        }),
        { status: 500, statusText: 'Internal Server Error' },
      ),
  );
  assert.match(unreadable.errorMessages[0], /Failed to read error response/);

  const slow = await send(
    t,
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
    { ...config, timeout: 20 },
  );
  assert.deepStrictEqual(slow.errorMessages, ['Plunk API request timed out after 20 ms.']);
});

test('Plunk: a 5xx is retried after a backoff', async (t) => {
  let calls = 0;
  const receipt = await send(
    t,
    async () =>
      ++calls === 1
        ? new Response('', { status: 502, statusText: 'Bad Gateway' })
        : Response.json({ success: true, emails: [{ contact: { id: 'c1' } }], timestamp: 'now' }),
    { ...config, retries: 1 },
  );
  assert.strictEqual(calls, 2);
  assert.strictEqual(receipt.successful, true);
});

test('Plunk: an attachment that cannot be read is left out with a warning', async (t) => {
  let body;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    body = JSON.parse(init.body);
    return Response.json({ success: true, emails: [], timestamp: 'now' });
  });
  const warn = t.mock.method(console, 'warn', () => {});
  const broken = () => {
    throw new Error('Cannot read attachment');
  };
  const attachments = [
    {
      inline: false,
      filename: 'a.bin',
      content: broken,
      contentType: 'application/octet-stream',
      contentId: '',
    },
  ];
  await new PlunkTransport(config).send(message({ attachments }));
  assert.strictEqual(warn.mock.callCount(), 1);
  assert.strictEqual(body.attachments, undefined);
});

test('Plunk: an abort during the wait between attempts ends the send at once', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('busy', { status: 503 }));
  const controller = new AbortController();
  const reason = new Error('Stopped by the caller.');
  setTimeout(() => controller.abort(reason), 20);
  const started = performance.now();
  await assert.rejects(
    new PlunkTransport({ apiKey: 'key', retries: 3 }).send(message(), {
      signal: controller.signal,
    }),
    (error) => error === reason,
  );
  assert.ok(performance.now() - started < 500);
});
