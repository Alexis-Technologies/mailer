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

test('HTTP/2: a GOAWAY with an error leaves the streams the server took of unknown fate', async (t) => {
  // Before (C3): Node destroys the streams of a session with one error, and
  // marking it unsent for the stream above the last of the GOAWAY marked the
  // streams the server handled too, which a retry then sent again.
  const server = await serve(t, (stream, _headers, index) => {
    // The server goes away as the third stream comes, the second its last.
    stream.session.on('error', () => {});
    if (index === 2) stream.session.goaway(NGHTTP2_INTERNAL_ERROR, stream.id - 2);
  });
  const client = createHttp2Fetch();
  t.after(() => client.close());
  const pending = [];
  for (const path of ['a', 'b', 'c']) {
    const request = client.fetch(`${server.origin}/${path}`, { method: 'POST', body: path });
    // Handled at once: an early one fails while the next is still to open.
    request.catch(() => {});
    pending.push(request);
    // Each stream reaches the server before the next is opened.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const results = await Promise.allSettled(pending);
  assert.deepStrictEqual(
    results.map((result) => result.status),
    ['rejected', 'rejected', 'rejected'],
  );
  assert.deepStrictEqual(
    results.map((result) => isUnsentRequestError(result.reason)),
    [false, false, true],
  );
});

// A server of raw frames, which Node's own server would not let answer a
// status beyond HTTP's: it answers stream 1 with `:status` `code`.
const rawStatusServer = async (t, code) => {
  const net = require('node:net');
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    // SETTINGS, empty.
    socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]));
    let answered = false;
    socket.on('data', () => {
      if (answered) return;
      answered = true;
      // SETTINGS ACK, then HEADERS of stream 1 (END_STREAM, END_HEADERS) whose
      // block is ':status' of the static table, a literal value.
      socket.write(Buffer.from([0, 0, 0, 4, 1, 0, 0, 0, 0]));
      const block = Buffer.from([0x08, 0x03, ...Buffer.from(code)]);
      socket.write(Buffer.concat([Buffer.from([0, 0, block.length, 1, 5, 0, 0, 0, 1]), block]));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
};

test('HTTP/2: a status beyond HTTP fails the request, not the process', async (t) => {
  // Before (C11): new Response threw a RangeError for a status of 600 to 999
  // in the listener of the response, which nothing caught.
  const origin = await rawStatusServer(t, '600');
  const client = createHttp2Fetch();
  t.after(() => client.close());
  await assert.rejects(
    client.fetch(`${origin}/3/device/a`, { method: 'POST', body: '{}' }),
    /status 600, which is none of HTTP/,
  );
});

// A session of the test, made by `connect`, whose streams fail as Node fails
// one when the ids of the session ran out: before any id.
const exhaustedSession = () => {
  const { EventEmitter } = require('node:events');
  const handle = new EventEmitter();
  Object.assign(handle, {
    closed: false,
    destroyed: false,
    unref() {},
    ref() {},
    ping() {},
    close(callback) {
      handle.closed = true;
      callback?.();
    },
    request() {
      const stream = new EventEmitter();
      Object.assign(stream, { id: undefined, rstCode: 0, end() {}, close() {}, destroy() {} });
      setImmediate(() => {
        stream.emit(
          'error',
          Object.assign(new Error('No stream ID is available'), {
            code: 'ERR_HTTP2_OUT_OF_STREAMS',
          }),
        );
        stream.emit('close');
      });
      return stream;
    },
  });
  return handle;
};

test('HTTP/2: a session out of stream ids is left, its request never sent', async (t) => {
  // Before (C12): Node fails the stream before it has an id and keeps the
  // session open, which stayed in use: every later request failed as of
  // unknown delivery, though none was sent.
  const sessions = [];
  const client = createHttp2Fetch({
    connect: () => {
      const handle = exhaustedSession();
      sessions.push(handle);
      return handle;
    },
  });
  t.after(() => client.close());
  const first = await client
    .fetch('https://api.example.com/a', { method: 'POST', body: '1' })
    .catch((error) => error);
  assert.strictEqual(isUnsentRequestError(first), true);
  assert.strictEqual(sessions[0].closed, true, 'the session is retired');
  await client.fetch('https://api.example.com/b', { method: 'POST', body: '2' }).catch(() => {});
  assert.strictEqual(sessions.length, 2, 'the next request opens another session');
});

test('HTTP/2: a ping cancelled while the session connects does not end it', async (t) => {
  // Before (C13): a ping made while the session connected, which Node cancels,
  // destroyed the session and the requests waiting on it.
  const { EventEmitter } = require('node:events');
  const handle = Object.assign(new EventEmitter(), {
    closed: false,
    destroyed: false,
    connecting: true,
    unref() {},
    ref() {},
    destroy() {
      handle.destroyed = true;
    },
    close(callback) {
      handle.closed = true;
      callback?.();
    },
    ping(callback) {
      callback(Object.assign(new Error('Ping was cancelled'), { code: 'ERR_HTTP2_PING_CANCEL' }));
    },
    request() {
      return Object.assign(new EventEmitter(), { end() {}, close() {}, destroy() {} });
    },
  });
  const client = createHttp2Fetch({ connect: () => handle, pingIntervalMs: 5 });
  t.after(() => client.close());
  client
    .fetch('https://api.example.com/a', {
      method: 'POST',
      body: '1',
      signal: AbortSignal.timeout(100),
    })
    .catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.strictEqual(handle.destroyed, false, 'not destroyed while connecting');
  handle.connecting = false;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.strictEqual(handle.destroyed, false, 'a cancelled ping ends nothing');
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

// A session of the test that answers nothing: no ping, no stream. Its streams
// get the id `streamId` (none while it connects), and `pings` counts pings.
const silentSession = (options = {}) => {
  const { EventEmitter } = require('node:events');
  // An id given as undefined is one, unlike a default of destructuring.
  const streamId = Object.hasOwn(options, 'streamId') ? options.streamId : 1;
  const { pingResult } = options;
  const handle = new EventEmitter();
  Object.assign(handle, {
    closed: false,
    destroyed: false,
    connecting: false,
    pings: 0,
    destroyedWith: undefined,
    unref() {},
    ref() {},
    destroy(error) {
      handle.destroyed = true;
      handle.destroyedWith = error;
      setImmediate(() => handle.emit('close'));
    },
    close(callback) {
      handle.closed = true;
      callback?.();
    },
    ping() {
      handle.pings++;
      return pingResult;
    },
    request() {
      const stream = new EventEmitter();
      Object.assign(stream, { id: streamId, rstCode: 0, end() {}, close() {}, destroy() {} });
      return stream;
    },
  });
  return handle;
};

test('HTTP/2: a ping left unanswered ends the session, and the next request opens another', async (t) => {
  // Before: Node's ping has no deadline, so a connection that died without a
  // word kept its session in use, every request on it timing out of unknown
  // delivery until the system gave the socket up, minutes later.
  const handles = [];
  const records = [];
  const client = createHttp2Fetch({
    connect: () => {
      const handle = silentSession();
      handles.push(handle);
      return handle;
    },
    pingIntervalMs: 5,
    pingTimeoutMs: 20,
    log: { write: (level, fields, message) => records.push([level, message, fields()]) },
  });
  t.after(() => client.close());
  client.fetch('https://api.example.com/a', { signal: AbortSignal.timeout(500) }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.strictEqual(handles[0].destroyed, true);
  assert.match(handles[0].destroyedWith.message, /answered no ping within 20 ms/);
  // One ping at a time, however short the interval.
  assert.strictEqual(handles[0].pings, 1);
  assert.deepStrictEqual(records[0].slice(0, 2), ['warn', 'http2.ping_timeout']);
  assert.strictEqual(records[0][2].origin, 'https://api.example.com');
  client.fetch('https://api.example.com/b', { signal: AbortSignal.timeout(50) }).catch(() => {});
  assert.strictEqual(handles.length, 2);
});

test('HTTP/2: a session whose pings Node no longer sends is ended', async (t) => {
  const handle = silentSession({ pingResult: false });
  const client = createHttp2Fetch({ connect: () => handle, pingIntervalMs: 5 });
  t.after(() => client.close());
  client.fetch('https://api.example.com/a', { signal: AbortSignal.timeout(200) }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.strictEqual(handle.destroyed, true);
  assert.match(handle.destroyedWith.message, /answered none of its last pings/);
});

test('HTTP/2: a request unanswered at its deadline pings its session at once', async (t) => {
  const handle = silentSession();
  const client = createHttp2Fetch({ connect: () => handle, pingIntervalMs: 60_000 });
  t.after(() => client.close());
  const error = await client
    .fetch('https://api.example.com/a', { signal: AbortSignal.timeout(20) })
    .catch((caught) => caught);
  assert.strictEqual(error.name, 'TimeoutError');
  // Sent, so of unknown fate: not marked unsent.
  assert.strictEqual(isUnsentRequestError(error), false);
  assert.strictEqual(handle.pings, 1);
});

test('HTTP/2: a request aborted while its session connects was never sent', async (t) => {
  // Before: the abort was rejected with its bare reason, though the stream
  // had no id, so a deadline met during a slow TLS handshake to APNs made a
  // push of unknown delivery, never retried, that never went.
  const handle = Object.assign(silentSession({ streamId: undefined }), { connecting: true });
  const client = createHttp2Fetch({ connect: () => handle });
  t.after(() => client.close());
  const caller = new AbortController();
  const reason = new Error('the reason of the caller');
  const pending = client.fetch('https://api.example.com/a', { signal: caller.signal });
  caller.abort(reason);
  const error = await pending.catch((caught) => caught);
  assert.strictEqual(error.name, 'AbortError');
  assert.strictEqual(error.cause, reason);
  assert.strictEqual(isUnsentRequestError(error), true);
  // The caller's reason is not marked.
  assert.strictEqual(isUnsentRequestError(reason), false);
  assert.strictEqual(handle.pings, 0);

  let requests = 0;
  const h2 = createHttp2Fetch({
    connect: () => {
      const connecting = Object.assign(silentSession({ streamId: undefined }), {
        connecting: true,
      });
      const request = connecting.request;
      connecting.request = () => {
        requests++;
        return request();
      };
      return connecting;
    },
  });
  t.after(() => h2.close());
  const api = createApiClient(
    { fetch: h2.fetch, retries: 1, timeout: 20, headers: {} },
    { id: 'apns', label: 'APNs', authorize: () => {} },
  );
  const failure = await api
    .request({ url: 'https://api.example.com/3/device/abc', body: { aps: {} } })
    .catch((caught) => caught);
  assert.strictEqual(requests, 2, 'sent again, as it never went');
  assert.strictEqual(isUnsentRequestError(failure), true);
  const { isDeliveryUnknown } = require('../../src/internal/delivery-unknown.js');
  assert.strictEqual(isDeliveryUnknown(failure), false);
});

test('HTTP/2: maxSessions opens another session while every one has a request out', async (t) => {
  // Before: one session of an origin carried every request, bounded by the
  // streams the server takes on it.
  const waiting = [];
  // The first three wait for their answer; the later ones are answered at once.
  const server = await serve(t, (stream, _headers, index) => {
    if (index < 3) {
      waiting.push(stream);
      return;
    }
    stream.respond({ ':status': 200 });
    stream.end('ok');
  });
  const client = createHttp2Fetch({ maxSessions: 2 });
  t.after(() => client.close());
  const pending = [];
  for (let i = 0; i < 3; i++) pending.push(client.fetch(`${server.origin}/${i}`));
  while (waiting.length < 3) await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(server.sessions.length, 2, 'no more than two');
  for (const stream of waiting) {
    stream.respond({ ':status': 200 });
    stream.end('ok');
  }
  for (const response of await Promise.all(pending))
    assert.strictEqual(await readText(response), 'ok');
  // An idle session takes the next request rather than a new one.
  await readText(await client.fetch(`${server.origin}/again`));
  assert.strictEqual(server.sessions.length, 2);
  // One session by default.
  const single = createHttp2Fetch();
  t.after(() => single.close());
  const one = await serve(t, (stream) => {
    stream.respond({ ':status': 200 });
    stream.end('ok');
  });
  await Promise.all([single.fetch(`${one.origin}/a`), single.fetch(`${one.origin}/b`)]);
  assert.strictEqual(one.sessions.length, 1);
});
