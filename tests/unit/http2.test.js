// Not ported: tests of the fetch over HTTP/2 (internal/http2.js) against a
// local h2c server, in place of node-apn's mock of node:http2.
const { test } = require('node:test');
const assert = require('node:assert');
const http2 = require('node:http2');
const { once } = require('node:events');
const { createHttp2Fetch } = require('../../src/internal/http2.js');
const { createApiClient } = require('../../src/internal/api-client.js');
const { readText } = require('../../src/internal/body.js');
const { isUnsentRequestError } = require('../../src/internal/unsent.js');

const { NGHTTP2_CANCEL, NGHTTP2_INTERNAL_ERROR, NGHTTP2_REFUSED_STREAM } = http2.constants;

// A server of the test, each stream answered by `handle(stream, headers)`.
const serve = async (t, handle) => {
  const server = http2.createServer();
  const sessions = [];
  const streams = [];
  server.on('session', (session) => sessions.push(session));
  server.on('stream', (stream, headers) => {
    // A stream the server closes with an error code fails on its side too.
    stream.on('error', () => {});
    streams.push({ stream, headers });
    handle(stream, headers, streams.length - 1);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const session of sessions) session.destroy();
    server.close();
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, sessions, streams };
};

const readBody = (stream) =>
  new Promise((resolve) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => (body += chunk));
    stream.on('end', () => resolve(body));
  });

test('HTTP/2: a request gets its response, its body read as it streams, on one session', async (t) => {
  const server = await serve(t, async (stream, headers) => {
    const body = await readBody(stream);
    stream.respond({ ':status': 200, 'content-type': 'application/json', 'apns-id': 'id-1' });
    stream.end(JSON.stringify({ method: headers[':method'], path: headers[':path'], body }));
  });
  const client = createHttp2Fetch();
  t.after(() => client.close());
  const first = await client.fetch(`${server.origin}/3/device/abc?x=1`, {
    method: 'POST',
    headers: { 'apns-topic': 'com.example.app', Connection: 'keep-alive', Host: 'evil.example' },
    body: '{"aps":{}}',
  });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.headers.get('apns-id'), 'id-1');
  assert.deepStrictEqual(JSON.parse(await readText(first)), {
    method: 'POST',
    path: '/3/device/abc?x=1',
    body: '{"aps":{}}',
  });
  const second = await client.fetch(`${server.origin}/3/device/def`, {
    method: 'POST',
    body: new Uint8Array([123, 125]),
  });
  assert.strictEqual(JSON.parse(await readText(second)).body, '{}');
  assert.strictEqual(server.sessions.length, 1);
  // The headers of HTTP/1.1 that HTTP/2 refuses are left out.
  assert.strictEqual(server.streams[0].headers['apns-topic'], 'com.example.app');
  assert.strictEqual(server.streams[0].headers.connection, undefined);
  assert.strictEqual(server.streams[0].headers.host, undefined);
});

test('HTTP/2: a response without a body has none', async (t) => {
  const server = await serve(t, (stream) => {
    stream.respond({ ':status': 204, 'set-cookie': ['a=1', 'b=2'] });
    stream.end();
  });
  const client = createHttp2Fetch();
  t.after(() => client.close());
  const response = await client.fetch(`${server.origin}/`);
  assert.strictEqual(response.status, 204);
  assert.strictEqual(response.body, null);
  assert.strictEqual(response.headers.get('set-cookie'), 'a=1, b=2');
});

test('HTTP/2: the deadline cancels the stream, before the answer and while its body comes', async (t) => {
  const server = await serve(t, (stream, headers) => {
    if (headers[':path'] === '/slow-body') {
      stream.respond({ ':status': 200 });
      stream.write('{"partial":');
    }
  });
  const client = createHttp2Fetch();
  t.after(() => client.close());
  const controller = new AbortController();
  const pending = client.fetch(`${server.origin}/hang`, { signal: controller.signal });
  while (server.streams.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const closed = once(server.streams[0].stream, 'close');
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  await closed;
  assert.strictEqual(server.streams[0].stream.rstCode, NGHTTP2_CANCEL);

  const late = new AbortController();
  const response = await client.fetch(`${server.origin}/slow-body`, { signal: late.signal });
  const reading = readText(response);
  late.abort();
  await assert.rejects(reading, (error) => error.name === 'AbortError');
  await assert.rejects(
    client.fetch(`${server.origin}/hang`, { signal: AbortSignal.abort() }),
    (error) => error.name === 'AbortError',
  );
});

test('HTTP/2: a stream refused, or above the last of a GOAWAY, was never sent', async (t) => {
  const server = await serve(t, (stream, headers, index) => {
    if (headers[':path'] === '/refuse') stream.close(NGHTTP2_REFUSED_STREAM);
    else if (headers[':path'] === '/reset') stream.close(NGHTTP2_INTERNAL_ERROR);
    else if (headers[':path'] === '/goaway') stream.session.goaway(0, index === 0 ? 0 : 1);
    else {
      stream.respond({ ':status': 200 });
      stream.end('ok');
    }
  });
  const client = createHttp2Fetch();
  t.after(() => client.close());
  await assert.rejects(client.fetch(`${server.origin}/refuse`), (error) =>
    isUnsentRequestError(error),
  );
  // A reset after the request reached the server may come after its effect.
  await assert.rejects(
    client.fetch(`${server.origin}/reset`),
    (error) => !isUnsentRequestError(error),
  );
  // The server goes away, having handled no stream: the request was not handled.
  await assert.rejects(client.fetch(`${server.origin}/goaway`), (error) =>
    isUnsentRequestError(error),
  );
  // The next request opens a new session.
  const response = await client.fetch(`${server.origin}/ok`);
  assert.strictEqual(await readText(response), 'ok');
  assert.ok(server.sessions.length >= 2);
});

test('HTTP/2: a session that closes is made anew; a refused connection was never sent', async (t) => {
  const server = await serve(t, (stream) => {
    stream.respond({ ':status': 200 });
    stream.end('ok');
  });
  const client = createHttp2Fetch({ pingIntervalMs: 5 });
  t.after(() => client.close());
  await readText(await client.fetch(`${server.origin}/a`));
  // Pings go out on an idle session and are answered.
  await new Promise((resolve) => setTimeout(resolve, 20));
  server.sessions[0].close();
  await once(server.sessions[0], 'close');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.strictEqual(await readText(await client.fetch(`${server.origin}/b`)), 'ok');
  assert.strictEqual(server.sessions.length, 2);

  const closed = http2.createServer();
  closed.listen(0, '127.0.0.1');
  await once(closed, 'listening');
  const { port } = closed.address();
  await new Promise((resolve) => closed.close(resolve));
  const refused = createHttp2Fetch();
  t.after(() => refused.close());
  await assert.rejects(refused.fetch(`http://127.0.0.1:${port}/`), (error) =>
    isUnsentRequestError(error),
  );
});

test('HTTP/2: the client of a provider sends through it as through fetch', async (t) => {
  const server = await serve(t, async (stream, headers) => {
    const body = await readBody(stream);
    stream.respond({ ':status': 200, 'content-type': 'application/json' });
    stream.end(JSON.stringify({ authorization: headers.authorization, body: JSON.parse(body) }));
  });
  const h2 = createHttp2Fetch();
  t.after(() => h2.close());
  const client = createApiClient(
    { fetch: h2.fetch, retries: 0, timeout: 5000, headers: {} },
    {
      id: 'apns',
      label: 'APNs',
      authorize: (headers) => headers.set('Authorization', 'bearer jwt'),
    },
  );
  const answer = await client.request({ url: `${server.origin}/3/device/abc`, body: { aps: {} } });
  assert.deepStrictEqual(answer.json, { authorization: 'bearer jwt', body: { aps: {} } });
});

test('HTTP/2: an idle session holds no process, so a script ends without close()', async (t) => {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  const server = await serve(t, (stream) => {
    stream.respond({ ':status': 200 });
    stream.end('ok');
  });
  const script = `
    const { createHttp2Fetch } = require(${JSON.stringify(path.join(__dirname, '../../src/internal/http2.js'))});
    createHttp2Fetch().fetch(${JSON.stringify(`${server.origin}/`)})
      .then((response) => response.text())
      .then((text) => process.stdout.write(text));
  `;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  const timer = setTimeout(() => child.kill(), 5000);
  const [code] = await once(child, 'exit');
  clearTimeout(timer);
  assert.strictEqual(output, 'ok');
  assert.strictEqual(code, 0);
});

test('HTTP/2: a stream closed with no answer fails; a request it cannot make was not sent', async (t) => {
  const server = await serve(t, (stream) => stream.close(http2.constants.NGHTTP2_NO_ERROR));
  const client = createHttp2Fetch();
  t.after(() => client.close());
  // Before: a stream reset with no error and no headers left the request
  // waiting for good.
  await assert.rejects(
    client.fetch(`${server.origin}/`),
    (error) => /closed with no response/.test(error.message) && !isUnsentRequestError(error),
  );
  // HTTP/2 takes TE only as "trailers": the request is refused before it goes.
  await assert.rejects(client.fetch(`${server.origin}/`, { headers: { te: 'gzip' } }), (error) =>
    isUnsentRequestError(error),
  );
});
