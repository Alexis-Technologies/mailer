// Paths of the ported SMTP transport (src/smtp/) that upstream's suites leave
// out or reach only through Mailpit: broken connections, rejected AUTH LOGIN
// steps, a rejected DATA, and the guards of the DATA writer.
const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createServer } = require('node:net');
const { createMessage } = require('../../index.js');
const { SmtpTransport } = require('../../src/smtp/index.js');
const { prepareOnSocket, writeMessageData } = require('../../src/smtp/data-stream.js');
const { checkSmtpPath } = require('../../src/smtp/envelope.js');
const { OAuth2TokenManager } = require('../../src/smtp/oauth2.js');
const { SmtpConnection } = require('../../src/smtp/smtp-connection.js');
const { MockSmtpServer } = require('../helpers/smtp/mock-smtp-server.js');

const message = () =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });

// A raw TCP server driven line by line, for replies MockSmtpServer cannot give.
const scripted = async (onLine, onConnection = (socket) => socket.write('220 ready\r\n')) => {
  const server = createServer((socket) => {
    socket.on('error', () => {});
    onConnection(socket);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        onLine(line, socket);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
};
const stop = (server) => new Promise((resolve) => server.close(() => resolve()));

const failureOf = async (transport) => {
  const receipt = await transport.send(message());
  await transport.closeAllConnections();
  assert.strictEqual(receipt.successful, false);
  return receipt.errorMessages.join(' | ');
};

// Answers a whole transaction through `reply(verb)`, with DATA_END for the
// reply to the end of the message data.
const transaction = (reply) => {
  let inData = false;
  return (line, socket) => {
    if (inData) {
      if (line === '.') {
        inData = false;
        socket.write(reply('DATA_END'));
      }
      return;
    }
    const verb = /^[A-Za-z]+/.exec(line)[0].toUpperCase();
    if (verb === 'QUIT') socket.end(reply(verb));
    else socket.write(reply(verb));
    if (verb === 'DATA') inData = true;
  };
};
const ok = { EHLO: '250 localhost\r\n', DATA: '354 go\r\n', QUIT: '221 bye\r\n' };
const okReply = (verb) => ok[verb] ?? '250 ok\r\n';

test('SMTP: a reply line that is the code alone ends the reply', async () => {
  const bare = { DATA: '354\r\n', QUIT: '221\r\n' };
  const { server, port } = await scripted(
    transaction((verb) => bare[verb] ?? '250\r\n'),
    (socket) => socket.write('220\r\n'),
  );
  try {
    const transport = new SmtpTransport({
      host: '127.0.0.1',
      port,
      pool: false,
      socketTimeout: 1000,
    });
    const receipt = await transport.send(message());
    assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join(' | '));
  } finally {
    await stop(server);
  }
});

test('SMTP: a reply line or a reply too long to be one fails the send at once', async () => {
  const servers = [
    // A greeting that never ends its line.
    () =>
      scripted(
        () => {},
        (socket) => socket.write(`220 ${'x'.repeat(9000)}`),
      ),
    // A greeting of more lines than a reply holds.
    () =>
      scripted(
        () => {},
        (socket) => socket.write('220-x\r\n'.repeat(1001)),
      ),
    // An EHLO reply of more lines than any server has capabilities.
    () =>
      scripted(
        transaction((verb) =>
          verb === 'EHLO' ? `${'250-x\r\n'.repeat(1001)}250 ok\r\n` : okReply(verb),
        ),
      ),
  ];
  for (const start of servers) {
    const { server, port } = await start();
    try {
      const transport = new SmtpTransport({
        host: '127.0.0.1',
        port,
        pool: false,
        socketTimeout: 2000,
      });
      assert.match(await failureOf(transport), /SMTP reply exceeds/);
    } finally {
      await stop(server);
    }
  }
});

test('SMTP: a character split across two chunks of a reply stays whole', async () => {
  const rejection = Buffer.from('550 Скриньки немає\r\n');
  const { server, port } = await scripted(
    transaction((verb) => {
      if (verb !== 'RCPT') return okReply(verb);
      return '';
    }),
  );
  server.on('connection', (socket) => {
    socket.on('data', (chunk) => {
      if (!chunk.toString('latin1').includes('RCPT TO')) return;
      // "С" is two bytes; the reply is cut between them.
      socket.write(rejection.subarray(0, 5));
      setTimeout(() => socket.write(rejection.subarray(5)), 20);
    });
  });
  try {
    const transport = new SmtpTransport({ host: '127.0.0.1', port, pool: false });
    assert.match(await failureOf(transport), /Скриньки немає/);
  } finally {
    await stop(server);
  }
});

test('SMTP: a server that closes before its greeting fails the send', async () => {
  const { server, port } = await scripted(
    () => {},
    (socket) => socket.destroy(),
  );
  try {
    const transport = new SmtpTransport({ host: '127.0.0.1', port, pool: false });
    assert.match(await failureOf(transport), /closed before greeting|ECONNRESET|socket/i);
  } finally {
    await stop(server);
  }
});

test('SMTP: a server that closes during STARTTLS fails the send', async () => {
  const { server, port } = await scripted((line, socket) => {
    if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 STARTTLS\r\n');
    else if (line === 'STARTTLS') socket.end('220 go ahead\r\n');
  });
  try {
    const transport = new SmtpTransport({ host: '127.0.0.1', port, pool: false });
    assert.match(await failureOf(transport), /STARTTLS|TLS|socket|disconnected/i);
  } finally {
    await stop(server);
  }
});

test('SMTP: AUTH LOGIN rejected at the method or at the user name', async () => {
  for (const [step, expected] of [
    [0, /AUTH LOGIN failed: Not here/],
    [1, /Username authentication failed: No such user/],
  ]) {
    let sent = 0;
    const { server, port } = await scripted((line, socket) => {
      if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 AUTH LOGIN\r\n');
      else if (line === 'AUTH LOGIN' || sent > 0) {
        socket.write(
          sent++ === step
            ? `535 ${step === 0 ? 'Not here' : 'No such user'}\r\n`
            : '334 VXNlcm5hbWU6\r\n',
        );
      } else if (line === 'QUIT') socket.end('221 bye\r\n');
    });
    try {
      const transport = new SmtpTransport({
        host: '127.0.0.1',
        port,
        pool: false,
        auth: { user: 'alex', pass: 'secret', method: 'login' },
      });
      assert.match(await failureOf(transport), expected);
    } finally {
      await stop(server);
    }
  }
});

test('SMTP: an unsupported AUTH method is refused when the transport is made', () => {
  // cram-md5 was in the type of upstream and never implemented.
  for (const auth of [
    { user: 'alex', pass: 'secret', method: 'cram-md5' },
    { user: 'alex', pass: 'secret', method: 'xoauth2' },
    { user: 'alex', accessToken: 'token', method: 'plain' },
  ]) {
    assert.throws(() => new SmtpTransport({ host: 'localhost', auth }), {
      name: 'TypeError',
      message: `Unsupported authentication method: ${auth.method}`,
    });
  }
  for (const auth of [
    { user: 'alex', pass: 'secret', method: 'login' },
    { user: 'alex', accessToken: 'token', method: 'oauthbearer' },
    { user: 'alex', pass: 'secret' },
  ]) {
    assert.ok(new SmtpTransport({ host: 'localhost', auth }));
  }
});

test('SMTP: a rejection after DATA fails the send', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  server.setResponse('DATA_END', { code: 554, message: 'Content rejected' });
  try {
    const transport = new SmtpTransport({ host: 'localhost', port, pool: false });
    assert.match(await failureOf(transport), /Content rejected/);
  } finally {
    await server.stop();
  }
});

test('SMTP: an address that would end the RCPT TO path never reaches the server', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  try {
    const transport = new SmtpTransport({ host: 'localhost', port, pool: false });
    const receipt = await transport.send(message(), {
      envelope: { to: ['user@example.com> NOTIFY=NEVER ORCPT=rfc822;a"@x.com'] },
    });
    assert.strictEqual(receipt.successful, false);
    const rcpt = server.getReceivedCommands().filter((command) => command.startsWith('RCPT'));
    assert.deepStrictEqual(rcpt, []);
  } finally {
    await server.stop();
  }
});

test('SMTP: a path that could end MAIL FROM or RCPT TO early is refused before it is written', () => {
  const unsafe = [
    'a@b.com> NOTIFY=NEVER',
    'a b@c.com',
    'a<b@c.com',
    'a@b.com\u0000',
    'a@b\u007f.com',
    '"x\\\u0001"@b.com',
  ];
  for (const path of unsafe) {
    assert.throws(() => checkSmtpPath(path), { name: 'SmtpEnvelopeValidationError' }, path);
  }
  const safe = [
    '',
    'a@b.com',
    '"john doe"@example.com',
    '"a>b"@example.com',
    '"a\\"b"@example.com',
  ];
  for (const path of safe) assert.doesNotThrow(() => checkSmtpPath(path), path);
});

const fakeSocket = (state = {}) =>
  Object.assign(new EventEmitter(), { destroyed: false, writable: true, destroy() {} }, state);

test('SMTP: message preparation fails on a socket that is already closed', async () => {
  const socket = fakeSocket({ destroyed: true, writable: false });
  await assert.rejects(
    prepareOnSocket(socket, 1000, () => new Promise(() => {})),
    { name: 'TypeError', message: 'SMTP connection closed during message preparation.' },
  );
});

test('SMTP: the DATA writer refuses a reply over 64 KiB, of unknown delivery', async () => {
  const socket = fakeSocket({
    write(chunk, callback) {
      if (chunk.toString() === '.\r\n') {
        queueMicrotask(() => socket.emit('data', Buffer.alloc(70000, 0x61)));
      }
      callback?.();
      return true;
    },
  });
  const source = async function* () {
    yield Buffer.from('Subject: x\r\n\r\nbody\r\n');
  };
  // The reply comes after the terminating dot, so the message may have been
  // accepted before the server went wrong.
  await assert.rejects(
    writeMessageData(socket, source, 1000, () => {}),
    (error) => {
      assert.strictEqual(error.name, 'SmtpDeliveryUnknownError');
      assert.strictEqual(error.cause.name, 'RangeError');
      assert.strictEqual(error.cause.message, 'SMTP DATA reply exceeds 64 KiB.');
      return true;
    },
  );
});

test('SMTP: a connection lost after the end of DATA is a receipt of unknown delivery', async () => {
  for (const [onEnd, category] of [
    [(socket) => socket.destroy(), 'network'],
    [() => {}, 'timeout'],
  ]) {
    const reply = transaction(okReply);
    const { server, port } = await scripted((line, socket) => {
      if (line === '.') onEnd(socket);
      else reply(line, socket);
    });
    try {
      const transport = new SmtpTransport({
        host: '127.0.0.1',
        port,
        pool: false,
        socketTimeout: 300,
      });
      const receipt = await transport.send(message());
      await transport.closeAllConnections();
      assert.strictEqual(receipt.successful, false);
      assert.strictEqual(receipt.deliveryUnknown, true, receipt.errorMessages.join(' | '));
      assert.strictEqual(receipt.retryable, false);
      assert.strictEqual(receipt.errors[0].category, category);
      assert.strictEqual(receipt.errors[0].code, 'smtp.delivery-unknown');
    } finally {
      await stop(server);
    }
  }
});

test('SMTP: a connection lost before the end of DATA is a plain failure', async () => {
  const socket = fakeSocket({
    write(chunk, callback) {
      callback?.();
      return true;
    },
  });
  const source = async function* () {
    yield Buffer.from('Subject: x\r\n\r\n');
    socket.emit('close');
    await new Promise(() => {});
  };
  await assert.rejects(
    writeMessageData(socket, source, 1000, () => {}),
    {
      name: 'TypeError',
      message: 'SMTP connection closed during DATA.',
    },
  );
});

test('SMTP: a reply during message preparation fails it', async () => {
  const socket = fakeSocket();
  const preparing = prepareOnSocket(socket, 1000, () => new Promise(() => {}));
  socket.emit('data', Buffer.from('421 closing\r\n'));
  await assert.rejects(preparing, {
    name: 'TypeError',
    message: 'Unexpected SMTP reply during message preparation.',
  });
});

test('SMTP: a connection reset in the middle of the envelope fails the send', async () => {
  const { server, port } = await scripted((line, socket) => {
    if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 PIPELINING\r\n');
    else if (line.startsWith('MAIL FROM')) socket.resetAndDestroy();
  });
  try {
    const transport = new SmtpTransport({ host: '127.0.0.1', port, pool: false });
    assert.match(await failureOf(transport), /ECONNRESET|closed|socket/i);
  } finally {
    await stop(server);
  }
});

test('SMTP: the OAuth2 token request does not follow a redirect', async () => {
  const redirects = [];
  const fetchFn = async (_url, init) => {
    redirects.push(init.redirect);
    return Response.json({ access_token: 'token', expires_in: 3600 });
  };
  const manager = new OAuth2TokenManager(
    {
      user: 'alex@example.com',
      clientId: 'client',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      tokenEndpoint: 'https://auth.example.com/token',
    },
    fetchFn,
  );
  assert.strictEqual(await manager.getAccessToken(), 'token');
  assert.deepStrictEqual(redirects, ['manual']);
});

test('SMTP: AUTH PLAIN and LOGIN encode credentials outside Latin-1 as UTF-8', async () => {
  const user = 'алекс@example.com';
  const pass = 'пароль-ü-✓';
  for (const method of ['plain', 'login']) {
    const lines = [];
    const reply = transaction((verb) =>
      verb === 'EHLO' ? '250-localhost\r\n250 AUTH PLAIN LOGIN\r\n' : okReply(verb),
    );
    let loginStep = 0;
    const { server, port } = await scripted((line, socket) => {
      if (line.startsWith('AUTH PLAIN ')) {
        lines.push(line.slice('AUTH PLAIN '.length));
        socket.write('235 ok\r\n');
      } else if (line === 'AUTH LOGIN') {
        socket.write('334 VXNlcm5hbWU6\r\n');
        loginStep = 1;
      } else if (loginStep > 0) {
        lines.push(line);
        socket.write(loginStep++ === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 ok\r\n');
        if (loginStep > 2) loginStep = 0;
      } else {
        reply(line, socket);
      }
    });
    try {
      const transport = new SmtpTransport({
        host: '127.0.0.1',
        port,
        pool: false,
        auth: { user, pass, method },
      });
      const receipt = await transport.send(message());
      assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join(' | '));
      const decoded = lines.map((line) => Buffer.from(line, 'base64').toString('utf8'));
      assert.deepStrictEqual(decoded, method === 'plain' ? [`\0${user}\0${pass}`] : [user, pass]);
    } finally {
      await stop(server);
    }
  }
});

test('SMTP: capabilities are looked up by keyword, rebuilt when replaced', () => {
  const connection = new SmtpConnection({ host: 'smtp.example.com' });
  connection.capabilities = ['size 10240000', 'AUTH=LOGIN PLAIN', 'PIPELINING', '8BITMIME'];
  assert.strictEqual(connection.capabilityLine('SIZE'), 'size 10240000');
  assert.strictEqual(connection.hasCapability('AUTH'), true);
  assert.strictEqual(connection.hasCapability('PIPE'), false);
  connection.capabilities = ['STARTTLS'];
  assert.strictEqual(connection.hasCapability('PIPELINING'), false);
  assert.strictEqual(connection.hasCapability('STARTTLS'), true);
});

test('SMTP: implicit TLS and STARTTLS send the host name for SNI, and no IP address', async () => {
  const { readFileSync } = require('node:fs');
  const path = require('node:path');
  const tls = require('node:tls');
  const credentials = {
    key: readFileSync(path.join(__dirname, '../fixtures/smtp/server-key.pem')),
    cert: readFileSync(path.join(__dirname, '../fixtures/smtp/server-cert.pem')),
  };
  const names = [];
  // Answers EHLO and QUIT over a socket that is already secure or upgrades.
  const serve = (socket, secure) => {
    socket.on('error', () => {});
    if (!secure) socket.write('220 ready\r\n');
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('latin1');
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line.startsWith('EHLO')) {
          socket.write(secure ? '250 ready\r\n' : '250-ready\r\n250 STARTTLS\r\n');
        } else if (line === 'STARTTLS') {
          socket.off('data', onData);
          socket.write('220 go ahead\r\n');
          const upgraded = new tls.TLSSocket(socket, {
            isServer: true,
            secureContext: tls.createSecureContext(credentials),
          });
          upgraded.on('secure', () => names.push(upgraded.servername));
          serve(upgraded, true);
          return;
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n');
        }
      }
    };
    socket.on('data', onData);
  };
  const implicit = tls.createServer(credentials, (socket) => {
    names.push(socket.servername);
    socket.write('220 ready\r\n');
    serve(socket, true);
  });
  const starttls = createServer((socket) => serve(socket, false));
  for (const server of [implicit, starttls]) {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  }
  try {
    for (const host of ['localhost', 'localhost.', '127.0.0.1']) {
      for (const server of [implicit, starttls]) {
        const transport = new SmtpTransport({
          host,
          port: server.address().port,
          secure: server === implicit,
          tls: { rejectUnauthorized: false },
        });
        await transport.verify();
        await transport.closeAllConnections();
      }
    }
  } finally {
    for (const server of [implicit, starttls]) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  // A server reads no SNI as false on Node, undefined on Bun and null on Deno.
  assert.deepStrictEqual(
    names.map((name) => name || false),
    ['localhost', 'localhost', 'localhost', 'localhost', false, false],
  );
});

test('SMTP: implicit TLS is connected once its handshake completes, within the timeout', async () => {
  // A server that accepts the connection and never answers the handshake.
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const connection = new SmtpConnection({
    host: '127.0.0.1',
    port: server.address().port,
    secure: true,
    connectionTimeout: 100,
    socketTimeout: 5000,
  });
  try {
    await assert.rejects(connection.connect(), { message: 'Connection timeout.' });
  } finally {
    connection.socket?.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SMTP: an abort while waiting for the greeting rejects with its reason', async () => {
  const { server, port } = await scripted(
    () => {},
    () => {},
  );
  const connection = new SmtpConnection({ host: '127.0.0.1', port, socketTimeout: 5000 });
  const controller = new AbortController();
  const reason = new Error('Stop.');
  try {
    await connection.connect();
    const greeting = connection.greeting(controller.signal);
    controller.abort(reason);
    await assert.rejects(greeting, (error) => error === reason);
    assert.strictEqual(connection.socket.destroyed, true);
  } finally {
    connection.socket?.destroy();
    await stop(server);
  }
});

test('SMTP: a message that cannot be composed takes no connection and fails no other', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  // A content type with a line break fails composition, past createMessage.
  const broken = {
    ...message(),
    attachments: [
      {
        inline: false,
        filename: 'a.txt',
        contentType: 'text/plain\r\nX-Injected: yes',
        content: new Uint8Array([0x61]),
        contentId: '',
      },
    ],
  };
  try {
    const transport = new SmtpTransport({ host: 'localhost', port, poolSize: 1 });
    assert.strictEqual((await transport.send(broken)).successful, false);
    const empty = [];
    for await (const receipt of transport.sendMany([])) empty.push(receipt);
    assert.deepStrictEqual(empty, []);
    assert.strictEqual(server.getConnectionCount(), 0);

    const outcomes = [];
    for await (const receipt of transport.sendMany([broken, message(), broken, message()])) {
      outcomes.push(receipt.successful);
    }
    assert.deepStrictEqual(outcomes, [false, true, false, true]);
    assert.strictEqual(server.getReceivedMessages().length, 2);
    assert.strictEqual(server.getConnectionCount(), 1);
    await transport.closeAllConnections();
  } finally {
    await server.stop();
  }
});

test('SMTP: a pooled connection is reset when it is next taken, not before the receipt', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  server.setResponseDelay('RSET', 300);
  try {
    const transport = new SmtpTransport({ host: 'localhost', port, poolSize: 1 });
    const started = performance.now();
    assert.strictEqual((await transport.send(message())).successful, true);
    assert.ok(performance.now() - started < 300, 'the receipt waited for RSET');
    assert.ok(!server.getReceivedCommands().includes('RSET'));

    assert.strictEqual((await transport.send(message())).successful, true);
    const commands = server.getReceivedCommands();
    const reset = commands.indexOf('RSET');
    assert.ok(reset > 0 && commands.slice(reset).some((command) => command.startsWith('MAIL')));
    assert.strictEqual(server.getConnectionCount(), 1);
    await transport.closeAllConnections();
  } finally {
    await server.stop();
  }
});

test('SMTP: a pooled connection whose reset fails is replaced, and an abort rejects', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  try {
    const transport = new SmtpTransport({ host: 'localhost', port, poolSize: 1 });
    assert.strictEqual((await transport.send(message())).successful, true);
    server.setResponse('RSET', { code: 421, message: 'Closing idle connection' });
    assert.strictEqual((await transport.send(message())).successful, true);
    assert.strictEqual(server.getConnectionCount(), 2);

    server.setResponse('RSET', { code: 250, message: 'OK' });
    server.setResponseDelay('RSET', 2000);
    const controller = new AbortController();
    const reason = new Error('Stop.');
    const sending = transport.send(message(), { signal: controller.signal });
    while (!server.getReceivedCommands().includes('RSET')) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    controller.abort(reason);
    await assert.rejects(sending, (error) => error === reason);
    server.setResponseDelay('RSET', 0);
    assert.strictEqual((await transport.send(message())).successful, true);
    assert.strictEqual(server.getConnectionCount(), 3);
    await transport.closeAllConnections();
  } finally {
    await server.stop();
  }
});

test('SMTP: the mock server takes a client that has gone as no failure of its own', async () => {
  const { connect } = require('node:net');
  const server = new MockSmtpServer();
  const port = await server.start();
  const client = connect(port, '127.0.0.1');
  try {
    while (server.connections.size === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const [socket] = server.connections;
    const failure = (code) => Object.assign(new Error(`write ${code}`), { code });
    // A reply written after the client closed: EPIPE on Linux, ECONNABORTED
    // on Windows, ECONNRESET on macOS.
    for (const code of ['ECONNRESET', 'EPIPE', 'ECONNABORTED']) {
      assert.doesNotThrow(() => socket.emit('error', failure(code)), code);
    }
    assert.throws(() => socket.emit('error', failure('EACCES')), { code: 'EACCES' });
    const heard = [];
    server.on('error', (error) => heard.push(error.code));
    socket.emit('error', failure('EPIPE'));
    assert.deepStrictEqual(heard, ['EPIPE']);
  } finally {
    client.destroy();
    await server.stop();
  }
});

test('SMTP: an idle pooled connection does not keep the process alive', async () => {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  const server = new MockSmtpServer();
  const port = await server.start();
  const script = `
    const { SmtpTransport } = require(${JSON.stringify(path.join(__dirname, '../../src/smtp/index.js'))});
    const { createMessage } = require(${JSON.stringify(path.join(__dirname, '../../index.js'))});
    const transport = new SmtpTransport({ host: 'localhost', port: ${port}, socketTimeout: 30000 });
    transport
      .send(createMessage({ from: 'a@example.com', to: 'b@example.com', subject: 's', content: { text: 't' } }))
      .then((receipt) => { if (!receipt.successful) process.exitCode = 2; });
  `;
  const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
  try {
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    assert.strictEqual(exited, 0, 'the process did not exit on its own');
    assert.strictEqual(server.getReceivedMessages().length, 1);
  } finally {
    child.kill();
    await server.stop();
  }
});

test('SMTP: generateId makes the Message-ID, and fetch refreshes the OAuth 2.0 token', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  const requests = [];
  const fetch = async (url, init) => {
    requests.push([String(url), init.method]);
    return Response.json({ access_token: 'token', expires_in: 3600 });
  };
  try {
    const transport = new SmtpTransport({
      host: 'localhost',
      port,
      generateId: (kind) => `01JTEST.${kind}`,
      fetch,
      auth: {
        type: 'oauth2',
        user: 'alex@example.com',
        clientId: 'id',
        clientSecret: 'secret',
        refreshToken: 'refresh',
        tokenEndpoint: 'http://localhost/token',
      },
    });
    const receipt = await transport.send(message());
    await transport.closeAllConnections();
    assert.strictEqual(receipt.successful, true);
    assert.match(
      server.getReceivedMessages()[0].data,
      /\r\nMessage-ID: <01JTEST\.message-id@example\.com>\r\n/,
    );
    assert.deepStrictEqual(requests, [['http://localhost/token', 'POST']]);

    const broken = new SmtpTransport({ host: 'localhost', port, generateId: () => 'a>b' });
    const failed = await broken.send(message());
    assert.strictEqual(failed.successful, false);
    assert.match(failed.errorMessages[0], /Invalid message-id from generateId/);
  } finally {
    await server.stop();
  }
});

test('SMTP: the logger hears the connection and the protocol, without credentials or addresses', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  const records = [];
  const logger = {
    isLevelEnabled: () => true,
    trace: (properties, text) => records.push(['trace', properties, text]),
    debug: (properties, text) => records.push(['debug', properties, text]),
    warn: (properties, text) => records.push(['warn', properties, text]),
  };
  try {
    const transport = new SmtpTransport({
      host: 'localhost',
      port,
      logger,
      auth: { user: 'alex@example.com', pass: 'hunter2-secret' },
    });
    assert.strictEqual((await transport.send(message())).successful, true);
    await transport.closeAllConnections();
  } finally {
    await server.stop();
  }
  const texts = records.map(([level, , text]) => `${level} ${text}`);
  assert.ok(texts.includes('debug SMTP connected'));
  assert.ok(texts.includes('debug SMTP authenticated'));
  // A loopback server is local development: no plaintext warning.
  assert.ok(!texts.some((text) => text.startsWith('warn')));
  const commands = records
    .filter(([, , text]) => text === 'SMTP commands')
    .flatMap(([, p]) => p.commands);
  assert.ok(commands.includes('AUTH PLAIN [REDACTED]'), JSON.stringify(commands));
  assert.ok(commands.includes('MAIL FROM:<[REDACTED]>'), JSON.stringify(commands));
  const logged = JSON.stringify(records);
  for (const secret of [
    'hunter2-secret',
    Buffer.from('\0alex@example.com\0hunter2-secret').toString('base64'),
    'bob@example.com',
    'alex@example.com',
  ]) {
    assert.ok(!logged.includes(secret), secret);
  }
  assert.ok(records.every(([, properties]) => properties.transport === 'smtp'));
});

test('SMTP: mail sent in plain text to another host is warned of, to the logger or console.warn', async (t) => {
  t.mock.method(SmtpConnection.prototype, 'isLocal', () => false);
  const consoleWarn = t.mock.method(console, 'warn', () => {});
  const server = new MockSmtpServer();
  const port = await server.start();
  try {
    const silent = new SmtpTransport({ host: 'localhost', port, pool: false });
    assert.strictEqual((await silent.send(message())).successful, true);
    assert.strictEqual(consoleWarn.mock.callCount(), 1);
    assert.match(consoleWarn.mock.calls[0].arguments[0], /^MAILER_SMTP_PLAINTEXT: /);

    const warnings = [];
    const logged = new SmtpTransport({
      host: 'localhost',
      port,
      pool: false,
      logger: { warn: (properties) => warnings.push(properties) },
    });
    assert.strictEqual((await logged.send(message())).successful, true);
    assert.strictEqual(consoleWarn.mock.callCount(), 1);
    assert.strictEqual(warnings[0].code, 'MAILER_SMTP_PLAINTEXT');
  } finally {
    await server.stop();
  }
});
