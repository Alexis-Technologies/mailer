// Not ported: the `connect` and `localAddress` of the SMTP transport, and the
// HTTP proxy connector ported from nodemailer, against local servers: an SMTP
// server of plain TCP, implicit TLS or STARTTLS, and an HTTP or HTTPS proxy.
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { createMessage } = require('../../index.js');
const { SmtpTransport, createHttpProxyConnector } = require('../../src/smtp/index.js');
const { ca, close, listen, proxyServer, smtpServer } = require('../helpers/smtp/servers.js');

const message = () =>
  createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'Hi',
    content: { text: 'Hi' },
  });

const send = async (config) => {
  const transport = new SmtpTransport({ pool: false, ...config });
  try {
    return await transport.send(message());
  } finally {
    await transport.closeAllConnections();
  }
};

test('SMTP connect: the connector opens the connection, given the host, port and a signal', async (t) => {
  const { port, state } = await smtpServer(t);
  const calls = [];
  const receipt = await send({
    host: 'localhost',
    port,
    localAddress: '127.0.0.1',
    connect: (options) => {
      calls.push(options);
      return net.connect(port, '127.0.0.1');
    },
  });
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.strictEqual(state.messages, 1);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].host, 'localhost');
  assert.strictEqual(calls[0].port, port);
  assert.strictEqual(calls[0].localAddress, '127.0.0.1');
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test('SMTP connect: implicit TLS and STARTTLS go over the tunnel', async (t) => {
  for (const mode of ['implicit', 'starttls']) {
    const { port, state } = await smtpServer(t, mode);
    const receipt = await send({
      host: 'localhost',
      port,
      secure: mode === 'implicit',
      requireTls: true,
      tls: { ca },
      auth: { user: 'u', pass: 'p' },
      connect: ({ port: target }) => net.connect(target, '127.0.0.1'),
    });
    assert.strictEqual(receipt.successful, true, `${mode}: ${receipt.errorMessages?.join()}`);
    assert.ok(
      state.commands.some((command) => command.startsWith('AUTH PLAIN')),
      mode,
    );
  }
});

test('SMTP connect: TLS over the tunnel fails on an untrusted certificate or a silent server', async (t) => {
  const { port } = await smtpServer(t, 'implicit');
  const untrusted = await send({
    host: 'localhost',
    port,
    secure: true,
    connect: () => net.connect(port, '127.0.0.1'),
  });
  assert.strictEqual(untrusted.successful, false);
  assert.strictEqual(untrusted.retryable, false);
  const silent = net.createServer((socket) => socket.on('error', () => {}));
  const silentPort = await listen(silent);
  t.after(() => {
    silent.close();
  });
  const sockets = [];
  const timedOut = await send({
    host: 'localhost',
    port: silentPort,
    secure: true,
    connectionTimeout: 50,
    connect: () => {
      const socket = net.connect(silentPort, '127.0.0.1');
      sockets.push(socket);
      return socket;
    },
  });
  assert.match(timedOut.errorMessages.join(), /Connection timeout/);
  assert.ok(sockets[0].destroyed);
});

test('SMTP connect: a tunnel to a remote host may not authenticate in clear', async (t) => {
  const { port, state } = await smtpServer(t);
  // The peer of the tunnel is 127.0.0.1, but the server is smtp.example.com.
  const remote = await send({
    host: 'smtp.example.com',
    port,
    auth: { user: 'u', pass: 'p' },
    connect: () => net.connect(port, '127.0.0.1'),
  });
  assert.strictEqual(remote.successful, false);
  assert.match(remote.errorMessages.join(), /requires a TLS-secured connection/);
  assert.ok(!state.commands.some((command) => command.startsWith('AUTH')));
  const local = await send({
    host: 'localhost',
    port,
    auth: { user: 'u', pass: 'p' },
    connect: () => net.connect(port, '127.0.0.1'),
  });
  assert.strictEqual(local.successful, true, local.errorMessages?.join());
});

test('SMTP connect: the connection timeout and the caller abort the connector', async () => {
  let seen;
  const timedOut = await send({
    host: 'localhost',
    connectionTimeout: 30,
    connect: ({ signal }) =>
      new Promise((resolve, reject) => {
        seen = signal;
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
  });
  assert.strictEqual(timedOut.successful, false);
  assert.match(timedOut.errorMessages.join(), /Connection timeout/);
  assert.strictEqual(seen.aborted, true);
  const transport = new SmtpTransport({
    host: 'localhost',
    pool: false,
    connect: ({ signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      ),
  });
  const controller = new AbortController();
  const sending = transport.send(message(), { signal: controller.signal });
  controller.abort(new Error('stopped'));
  await assert.rejects(sending, /stopped/);
  const bad = await send({ host: 'localhost', connect: () => ({}) });
  assert.match(bad.errorMessages.join(), /connect must resolve to a connected net.Socket/);
});

test('SMTP connect: localAddress and connect are checked when the transport is made', () => {
  assert.throws(
    () => new SmtpTransport({ host: 'h', localAddress: 'eth0' }),
    /localAddress must be an IP/,
  );
  assert.throws(
    () => new SmtpTransport({ host: 'h', connect: 'proxy' }),
    /connect must be a function/,
  );
});

test('SMTP proxy: CONNECT through an HTTP proxy, with Basic credentials in UTF-8', async (t) => {
  const { port, state } = await smtpServer(t);
  const proxy = await proxyServer(t);
  const url = new URL(proxy.url);
  url.username = encodeURIComponent('юзер');
  url.password = encodeURIComponent('p@ss:word');
  const receipt = await send({
    host: '127.0.0.1',
    port,
    connect: createHttpProxyConnector({ url: url.href, headers: { 'X-Team': 'mail' } }),
  });
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.strictEqual(state.messages, 1);
  assert.strictEqual(proxy.requests[0].url, `127.0.0.1:${port}`);
  assert.strictEqual(proxy.requests[0].headers.host, `127.0.0.1:${port}`);
  assert.strictEqual(proxy.requests[0].headers['x-team'], 'mail');
  const basic = proxy.requests[0].headers['proxy-authorization'].slice('Basic '.length);
  assert.strictEqual(Buffer.from(basic, 'base64').toString('utf8'), 'юзер:p@ss:word');
});

test('SMTP proxy: an HTTPS proxy is checked against its CA', async (t) => {
  const { port, state } = await smtpServer(t);
  const proxy = await proxyServer(t, { secure: true });
  const url = proxy.url.replace('127.0.0.1', 'localhost');
  const receipt = await send({
    host: '127.0.0.1',
    port,
    connect: createHttpProxyConnector({ url, tls: { ca } }),
  });
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.strictEqual(state.messages, 1);
  const untrusted = await send({
    host: '127.0.0.1',
    port,
    connect: createHttpProxyConnector({ url }),
  });
  assert.strictEqual(untrusted.successful, false);
  assert.strictEqual(untrusted.retryable, false);
});

test('SMTP proxy: an IPv6 destination is bracketed, which nodemailer wrote bare', async (t) => {
  const proxy = await proxyServer(t, {
    reply: (request, client) => client.end('HTTP/1.1 403 Forbidden\r\n\r\n'),
  });
  const receipt = await send({
    host: '::1',
    port: 2525,
    connect: createHttpProxyConnector({ url: proxy.url }),
  });
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(proxy.requests[0].url, '[::1]:2525');
  assert.strictEqual(proxy.requests[0].headers.host, '[::1]:2525');
  assert.match(receipt.errorMessages.join(), /did not connect to \[::1\]:2525: HTTP 403/);
  assert.strictEqual(receipt.retryable, true);
});

test('SMTP proxy: a greeting sent with the reply to CONNECT is not lost', async (t) => {
  // A proxy that is the SMTP server too, answering CONNECT and greeting in
  // one write.
  let commands = 0;
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    let buffer = '';
    let connected = false;
    let inData = false;
    socket.on('data', (bytes) => {
      buffer += bytes.toString('latin1');
      if (!connected) {
        if (!buffer.includes('\r\n\r\n')) return;
        connected = true;
        buffer = buffer.slice(buffer.indexOf('\r\n\r\n') + 4);
        socket.write('HTTP/1.1 200 OK\r\n\r\n220 ready\r\n');
        return;
      }
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        commands++;
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 queued\r\n');
          }
        } else if (line.startsWith('DATA')) {
          inData = true;
          socket.write('354 go\r\n');
        } else if (line.startsWith('QUIT')) {
          socket.end('221 bye\r\n');
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
  });
  const port = await listen(server);
  t.after(() => close(server));
  const receipt = await send({
    host: 'localhost',
    port: 25,
    connect: createHttpProxyConnector({ url: `http://127.0.0.1:${port}` }),
  });
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.ok(commands > 0);
});

test('SMTP proxy: 407, a broken reply, a timeout and an abort fail the connection', async (t) => {
  const answers = {
    auth: (request, client) => client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'),
    garbage: (request, client) => client.end('SMTP/1.0 200 OK\r\n\r\n'),
    silent: () => {},
    huge: (request, client) => client.write(`HTTP/1.1 200 OK\r\nX: ${'a'.repeat(70 * 1024)}`),
    closed: (request, client) => client.destroy(),
  };
  const failures = {};
  for (const [name, reply] of Object.entries(answers)) {
    const proxy = await proxyServer(t, { reply });
    const receipt = await send({
      host: 'smtp.example.com',
      connect: createHttpProxyConnector({ url: proxy.url, timeout: 100 }),
    });
    assert.strictEqual(receipt.successful, false, name);
    failures[name] = receipt;
  }
  assert.match(failures.auth.errorMessages.join(), /asks for authentication .* \(HTTP 407\)/);
  assert.strictEqual(failures.auth.retryable, false);
  assert.match(failures.garbage.errorMessages.join(), /with an HTTP status line/);
  assert.match(failures.silent.errorMessages.join(), /timed out on CONNECT/);
  assert.match(failures.huge.errorMessages.join(), /with an HTTP status line/);
  assert.match(failures.closed.errorMessages.join(), /closed the connection/);
  const proxy = await proxyServer(t, { reply: () => {} });
  const connector = createHttpProxyConnector({ url: proxy.url, timeout: 0 });
  const controller = new AbortController();
  const connecting = connector({ host: 'smtp.example.com', port: 25, signal: controller.signal });
  setTimeout(() => controller.abort(new Error('stopped')), 20);
  await assert.rejects(connecting, /stopped/);
});

test('SMTP proxy: the options and the destination are checked', async () => {
  assert.throws(() => createHttpProxyConnector(), /needs \{ url \}/);
  assert.throws(() => createHttpProxyConnector({ url: 'socks5://proxy:1080' }), /http or https/);
  assert.throws(() => createHttpProxyConnector({ url: 'not a url' }), /not a URL/);
  assert.throws(
    () => createHttpProxyConnector({ url: 'http://proxy', headers: { 'Bad Name': 'x' } }),
    /Invalid proxy header field/,
  );
  assert.throws(
    () => createHttpProxyConnector({ url: 'http://proxy', headers: { 'X-A': 'a\r\nB: b' } }),
    /Invalid proxy header field/,
  );
  assert.throws(() => createHttpProxyConnector({ url: 'http://proxy', timeout: -1 }), /timeout/);
  const connector = createHttpProxyConnector({ url: 'http://127.0.0.1:9' });
  await assert.rejects(connector({ host: 'a\r\nb', port: 25 }), /destination host/);
  await assert.rejects(connector({ host: 'smtp.example.com', port: 0 }), /destination port/);
});

test('SMTP proxy: credentials go to an http proxy only on this machine, unless allowed', () => {
  // Before: Basic credentials of the proxy URL went in clear to any host.
  assert.throws(
    () => createHttpProxyConnector({ url: 'http://user:pass@proxy.example.com:3128' }),
    /would go in clear/,
  );
  assert.throws(() => createHttpProxyConnector({ url: 'http://:pass@10.0.0.2:3128' }), /in clear/);
  assert.ok(createHttpProxyConnector({ url: 'http://user:pass@127.0.0.1:3128' }));
  assert.ok(createHttpProxyConnector({ url: 'http://user:pass@localhost:3128' }));
  assert.ok(createHttpProxyConnector({ url: 'https://user:pass@proxy.example.com' }));
  assert.ok(createHttpProxyConnector({ url: 'http://proxy.example.com:3128' }));
  assert.ok(
    createHttpProxyConnector({
      url: 'http://user:pass@proxy.example.com:3128',
      allowPlaintextCredentials: true,
    }),
  );
});

test('SMTP proxy: the timeout bounds the whole CONNECT, not each wait for a byte', async (t) => {
  // Before: a socket timeout, which a proxy writing a byte at a time never let fire.
  const trickle = (request, client) => {
    const timer = setInterval(() => client.write('H'), 20);
    client.on('close', () => clearInterval(timer));
  };
  const proxy = await proxyServer(t, { reply: trickle });
  const connector = createHttpProxyConnector({ url: proxy.url, timeout: 150 });
  const started = Date.now();
  await assert.rejects(connector({ host: 'smtp.example.com', port: 25 }), /timed out on CONNECT/);
  assert.ok(Date.now() - started < 1000);
});
