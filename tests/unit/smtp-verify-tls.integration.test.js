// Ported from upyo v0.7.0 (packages/smtp/src/verify-tls.integration.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:net');
const { createSecureContext, createServer: createTlsServer, TLSSocket } = require('node:tls');
const { SmtpTransport } = require('../../src/smtp/index.js');

const credentials = {
  key: readFileSync(path.join(__dirname, '../fixtures/smtp/server-key.pem')),
  cert: readFileSync(path.join(__dirname, '../fixtures/smtp/server-cert.pem')),
};

const setup = async (implicit, stall = '') => {
  const sockets = new Set();
  const commands = [];
  let resolveReached;
  const reachedPromise = new Promise((resolve) => {
    resolveReached = resolve;
  });
  const reached = { promise: reachedPromise, resolve: resolveReached };
  const handle = (socket, upgraded = false) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    if (stall === 'implicit') {
      socket.once('data', () => reached.resolve());
      return;
    }
    if (!upgraded) {
      if (stall === 'greeting') {
        reached.resolve();
        return;
      }
      socket.write('220 ready\r\n');
    }
    let buffer = '';
    const onData = (bytes) => {
      buffer += Buffer.from(bytes).toString();
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const command = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        commands.push(command);
        if (command.startsWith('EHLO')) {
          socket.write(
            implicit || upgraded
              ? '250-ready\r\n250 AUTH PLAIN\r\n'
              : '250-ready\r\n250 STARTTLS\r\n',
          );
        } else if (command === 'STARTTLS') {
          socket.off('data', onData);
          socket.write('220 upgrade\r\n');
          if (stall === 'STARTTLS') {
            socket.once('data', () => reached.resolve());
            return;
          }
          handle(
            new TLSSocket(socket, {
              isServer: true,
              secureContext: createSecureContext(credentials),
            }),
            true,
          );
          return;
        } else if (command.startsWith('AUTH')) {
          if (stall === 'AUTH') {
            reached.resolve();
            return;
          }
          socket.write('235 authenticated\r\n');
        } else if (command === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('500 unexpected command\r\n');
      }
    };
    socket.on('data', onData);
  };
  const server =
    implicit && stall !== 'implicit' ? createTlsServer(credentials, handle) : createServer(handle);
  server.on('tlsClientError', () => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const transport = new SmtpTransport({
    host: '127.0.0.1',
    port: address.port,
    secure: implicit,
    requireTls: !implicit,
    tls: { rejectUnauthorized: false },
    auth: { user: 'u', pass: 'p' },
    connectionTimeout: 150,
    socketTimeout: 150,
  });
  return {
    transport,
    commands,
    reached,
    sockets,
    async close() {
      await transport.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
};

for (const implicit of [false, true]) {
  test(`verify negotiates real ${implicit ? 'implicit TLS' : 'STARTTLS'} and rejects untrusted certificates`, async () => {
    const f = await setup(implicit);
    try {
      await f.transport.verify();
      assert.equal(f.commands.filter((c) => c.startsWith('EHLO')).length, implicit ? 1 : 2);
      assert.ok(f.commands.some((c) => c.startsWith('AUTH PLAIN')));
      assert.ok(f.commands.every((c) => /^(EHLO|STARTTLS|AUTH|QUIT)\b/.test(c)));
      f.transport.config = {
        ...f.transport.config,
        tls: { rejectUnauthorized: true },
      };
      await assert.rejects(f.transport.verify());
    } finally {
      await f.close();
    }
  });
}

for (const stage of ['greeting', 'implicit', 'STARTTLS', 'AUTH']) {
  for (const cancel of [false, true]) {
    test(`verify ${stage} ${cancel ? 'cancellation' : 'timeout'} releases its connection`, async () => {
      const f = await setup(stage === 'implicit', stage);
      const controller = new AbortController();
      const reason = new TypeError('Canceled.');
      try {
        if (cancel) {
          f.transport.config = {
            ...f.transport.config,
            connectionTimeout: 5000,
            socketTimeout: 5000,
          };
        }
        const pending = f.transport.verify({ signal: controller.signal });
        const checked = assert.rejects(pending, (e) =>
          cancel ? e === reason : e instanceof Error,
        );
        await f.reached.promise;
        if (cancel) controller.abort(reason);
        await checked;
        await f.transport.closeAllConnections();
        assert.ok(f.commands.every((c) => !/^(MAIL|RCPT|DATA|BDAT)\b/.test(c)));
      } finally {
        controller.abort(reason);
        await f.close();
      }
    });
  }
}
