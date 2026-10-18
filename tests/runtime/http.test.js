// Not ported: an HTTP provider and ./attachments on the fetch of the runtime
// that runs the test (Node, Bun or Deno), with no mock, against a local server.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { createMessage, readAttachmentContent } = require('@alexify/mailer');
const { PostmarkTransport } = require('@alexify/mailer/postmark');
const { fromUrl } = require('@alexify/mailer/attachments');
const { credentials } = require('../helpers/smtp/servers.js');

// Listens on a free port of the loopback address, closed after the test.
const listen = async (t, listener) => {
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => listener.close(() => resolve())));
};

// A server that records each request with its body, then answers as
// `answer(request, response, count)` says.
const server = async (t, answer) => {
  const requests = [];
  const sockets = new Set();
  const listener = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: request.method, url: request.url, headers: request.headers, body });
      answer(request, response, requests.length);
    });
  });
  listener.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        listener.close(() => resolve());
      }),
  );
  return { requests, url: `http://127.0.0.1:${listener.address().port}` };
};

const accepted = (response, id = 'pm-1') => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ MessageID: id, ErrorCode: 0, Message: 'OK' }));
};

const message = () =>
  createMessage({
    from: { name: 'Shop', address: 'shop@example.com' },
    to: 'bob@example.com',
    subject: 'Grüße',
    content: { text: 'Hello', html: '<p>Hello</p>' },
    attachments: [new File(['report'], 'report.txt', { type: 'text/plain' })],
  });

const postmark = (url, config) =>
  new PostmarkTransport({ serverToken: 'pm-token', baseUrl: url, ...config });

// The fetch the documentation gives for Deno, whose own fetch sends a request
// again when a reused connection closes before its answer: a client that keeps
// no idle connection.
const fetchWithoutReuse = (t) => {
  const client = globalThis.Deno.createHttpClient({ poolMaxIdlePerHost: 0 });
  t.after(() => client.close());
  return (input, init) => fetch(input, { ...init, client });
};

test('Runtime HTTP: a request goes through the fetch of the runtime and its answer is read', async (t) => {
  const { requests, url } = await server(t, (_request, response) => accepted(response));
  const receipt = await postmark(url).send(message());
  assert.deepStrictEqual(receipt, { successful: true, messageId: 'pm-1', provider: 'postmark' });
  const [request] = requests;
  assert.strictEqual(request.method, 'POST');
  assert.strictEqual(request.url, '/email');
  assert.strictEqual(request.headers['x-postmark-server-token'], 'pm-token');
  const body = JSON.parse(request.body);
  assert.strictEqual(body.From, 'Shop <shop@example.com>');
  assert.strictEqual(body.Subject, 'Grüße');
  assert.deepStrictEqual(body.Attachments[0].Name, 'report.txt');
  assert.strictEqual(Buffer.from(body.Attachments[0].Content, 'base64').toString(), 'report');
});

test('Runtime HTTP: a redirect is a failure, and is not followed', async (t) => {
  const { requests, url } = await server(t, (request, response) => {
    if (request.url === '/elsewhere') return accepted(response);
    response.writeHead(307, { location: '/elsewhere' }).end();
  });
  const receipt = await postmark(url).send(message());
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.retryable, false);
  assert.deepStrictEqual(
    requests.map((request) => request.url),
    ['/email'],
  );
});

test('Runtime HTTP: an answer over 4 MiB is refused as it comes', async (t) => {
  const chunk = Buffer.alloc(1024 * 1024, 'x');
  const { requests, url } = await server(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    for (let i = 0; i < 5; i++) response.write(chunk);
    response.end();
  });
  const receipt = await postmark(url).send(message());
  // The provider answered 200, so it may have taken the message.
  assert.strictEqual(receipt.deliveryUnknown, true);
  assert.match(receipt.errorMessages[0], /4 MiB|4194304|too large/i);
  assert.strictEqual(requests.length, 1);
});

test('Runtime HTTP: a request whose answer is lost is of unknown delivery, and goes once', async (t) => {
  const { requests, url } = await server(t, (request) => request.socket.destroy());
  const receipt = await postmark(url).send(message());
  assert.strictEqual(receipt.deliveryUnknown, true);
  assert.strictEqual(requests.length, 1);
});

test('Runtime HTTP: on a reused connection too, with the fetch the docs give for Deno', async (t) => {
  const { requests, url } = await server(t, (request, response, count) =>
    count === 1 ? accepted(response) : request.socket.destroy(),
  );
  const fetch = globalThis.Deno === undefined ? globalThis.fetch : fetchWithoutReuse(t);
  const transport = postmark(url, { fetch });
  assert.strictEqual((await transport.send(message())).successful, true);
  const lost = await transport.send(message());
  assert.strictEqual(lost.deliveryUnknown, true);
  assert.strictEqual(requests.length, 2);
});

// Why the documentation gives Deno its own fetch: when this fails, Deno no
// longer sends a request twice, and the documentation can say so.
test(
  "Runtime HTTP: Deno's own fetch sends a lost request again on a reused connection",
  {
    skip: globalThis.Deno === undefined && 'Deno only',
  },
  async (t) => {
    const { requests, url } = await server(t, (request, response, count) =>
      count === 1 ? accepted(response) : request.socket.destroy(),
    );
    const transport = postmark(url);
    assert.strictEqual((await transport.send(message())).successful, true);
    const lost = await transport.send(message());
    assert.strictEqual(lost.deliveryUnknown, true);
    assert.strictEqual(requests.length, 3);
  },
);

test('Runtime HTTP: a certificate of an unknown CA fails at once, as configuration', async (t) => {
  // An HTTPS server with the certificate of the test CA, which the runtime
  // does not trust, behind a TCP relay that counts each connection, an
  // attempt: the HTTPS server of Bun emits no `connection`.
  const listener = https.createServer(credentials, (_request, response) => accepted(response));
  listener.on('tlsClientError', () => {});
  await listen(t, listener);
  let connections = 0;
  const relay = net.createServer((socket) => {
    connections++;
    const upstream = net.connect(listener.address().port, '127.0.0.1');
    socket.on('error', () => {});
    upstream.on('error', () => {});
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await listen(t, relay);
  const url = `https://localhost:${relay.address().port}`;
  const receipt = await postmark(url, { retries: 2 }).send(message());
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.errors[0].category, 'configuration', receipt.errorMessages.join());
  assert.strictEqual(receipt.retryable, false);
  assert.strictEqual(receipt.deliveryUnknown, undefined);
  assert.strictEqual(connections, 1);
});

test('Runtime attachments: fromUrl reads through the fetch of the runtime, checking each URL', async (t) => {
  const { requests, url } = await server(t, (request, response) => {
    if (request.url === '/moved') {
      response.writeHead(302, { location: '/report.txt' }).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' }).end('report');
  });
  const allowed = [];
  const allowUrl = (target) => {
    allowed.push(target.pathname);
    return true;
  };
  const attachment = await fromUrl(`${url}/moved`, { allowUrl });
  assert.strictEqual(
    new TextDecoder().decode(await readAttachmentContent(attachment.content)),
    'report',
  );
  assert.strictEqual(attachment.filename, 'report.txt');
  assert.deepStrictEqual(allowed, ['/moved', '/report.txt']);
  const before = requests.length;
  await assert.rejects(
    fromUrl(`${url}/moved`, { allowUrl: (target) => target.pathname === '/moved' }),
  );
  assert.strictEqual(requests.length, before + 1);
});

test('Runtime attachments: the default check resolves a name, a private answer refused', async () => {
  // The default allowUrl on each runtime: a name whose lookup gives a private
  // or a cloud metadata address is refused before any request, and one that
  // gives a public address passes the check.
  const asked = [];
  const lookup = async (hostname) => {
    asked.push(hostname);
    if (hostname === 'internal.example.com') return [{ address: '10.0.0.1', family: 4 }];
    if (hostname === 'metadata.example.com') return [{ address: '169.254.169.254', family: 4 }];
    return [{ address: '93.184.215.14', family: 4 }];
  };
  let fetched = 0;
  const fetch = async () => {
    fetched++;
    return new Response('ok', { headers: { 'content-type': 'text/plain' } });
  };
  for (const host of ['internal.example.com', 'metadata.example.com']) {
    await assert.rejects(fromUrl(`https://${host}/a.txt`, { lookup, fetch }), RangeError);
  }
  assert.strictEqual(fetched, 0);
  const attachment = await fromUrl('https://public.example.com/a.txt', { lookup, fetch });
  assert.strictEqual(attachment.filename, 'a.txt');
  assert.strictEqual(fetched, 1);
  assert.deepStrictEqual(asked, [
    'internal.example.com',
    'metadata.example.com',
    'public.example.com',
  ]);
});
