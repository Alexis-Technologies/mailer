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

test('SMTP: an unsupported AUTH method fails the send', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  server.setCapabilities(['AUTH PLAIN LOGIN CRAM-MD5']);
  try {
    const transport = new SmtpTransport({
      host: 'localhost',
      port,
      pool: false,
      auth: { user: 'alex', pass: 'secret', method: 'cram-md5' },
    });
    assert.match(await failureOf(transport), /Unsupported authentication method: cram-md5/);
  } finally {
    await server.stop();
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
