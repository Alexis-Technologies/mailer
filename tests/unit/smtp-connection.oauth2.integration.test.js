// Ported from upyo v0.7.0 (packages/smtp/src/smtp-connection.oauth2.integration.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { Socket } = require('node:net');
const { describe, test } = require('node:test');
const { SmtpConnection } = require('../../src/smtp/smtp-connection.js');
const { SmtpAuthError } = require('../../src/smtp/oauth2.js');
const { MockSmtpServer } = require('../helpers/smtp/mock-smtp-server.js');

describe('SMTP OAuth 2.0 authentication', () => {
  const setup = async (auth) => {
    const server = new MockSmtpServer();
    await server.start();
    const config = {
      host: 'localhost',
      port: server.getPort(),
      secure: false,
      connectionTimeout: 5000,
      socketTimeout: 5000,
      localName: 'test.local',
      auth,
    };
    const connection = new SmtpConnection(config);
    return { server, connection };
  };

  const teardown = async (server, connection) => {
    try {
      await connection.quit();
    } catch {
      // Ignore cleanup errors.
    }
    await server.stop();
    await new Promise((resolve) => setTimeout(resolve, 1));
  };

  const decodeAuthInitialResponse = (authCommand) => {
    const parts = authCommand.split(' ');
    return atob(parts[2]);
  };

  test('authenticates with XOAUTH2 using a static token', async () => {
    const { server, connection } = await setup({
      user: 'user@example.com',
      accessToken: 'the-access-token',
    });
    try {
      await connection.connect();
      await connection.greeting();
      await connection.ehlo();
      await connection.authenticate();

      assert.ok(connection.authenticated);
      const command = server.getLastAuthCommand();
      assert.ok(command != null);
      assert.ok(command.startsWith('AUTH XOAUTH2 '));
      assert.equal(
        decodeAuthInitialResponse(command),
        'user=user@example.com\x01auth=Bearer the-access-token\x01\x01',
      );
    } finally {
      await teardown(server, connection);
    }
  });

  test('authenticates with XOAUTH2 using a synchronous token provider', async () => {
    let called = false;
    const { server, connection } = await setup({
      user: 'user@example.com',
      accessToken: () => {
        called = true;
        return 'provided-token';
      },
    });
    try {
      await connection.connect();
      await connection.greeting();
      await connection.ehlo();
      await connection.authenticate();

      assert.ok(connection.authenticated);
      assert.ok(called);
    } finally {
      await teardown(server, connection);
    }
  });

  test('uses the two-step SASL form for an over-long XOAUTH2 token', async () => {
    // A long token (e.g. an Outlook JWT) overflows the SMTP command-line limit,
    // so the initial response must be sent on its own line after a 334.
    const longToken = 'x'.repeat(800);
    const { server, connection } = await setup({
      user: 'user@example.com',
      accessToken: longToken,
    });
    try {
      await connection.connect();
      await connection.greeting();
      await connection.ehlo();
      await connection.authenticate();

      assert.ok(connection.authenticated);
      // The AUTH command carried no inline initial response.
      assert.equal(server.getLastAuthCommand(), 'AUTH XOAUTH2');
    } finally {
      await teardown(server, connection);
    }
  });

  test('authenticates with XOAUTH2 using an asynchronous token provider', async () => {
    const { server, connection } = await setup({
      user: 'user@example.com',
      accessToken: () => Promise.resolve('async-token'),
    });
    try {
      await connection.connect();
      await connection.greeting();
      await connection.ehlo();
      await connection.authenticate();

      assert.ok(connection.authenticated);
    } finally {
      await teardown(server, connection);
    }
  });

  test('rejects XOAUTH2 failure via the 334 challenge continuation', async () => {
    const { server, connection } = await setup({
      user: 'user@example.com',
      accessToken: 'bad-token',
    });
    server.setResponse('AUTH', { code: 535, message: '5.7.8 Bad credentials' });
    try {
      await connection.connect();
      await connection.greeting();
      await connection.ehlo();

      await assert.rejects(
        connection.authenticate(),
        (error) =>
          error instanceof SmtpAuthError &&
          /XOAUTH2/.test(error.message) &&
          // The empty continuation was accepted, so the final server reply is
          // the real failure rather than a rejected-continuation error.
          /Bad credentials/.test(error.message),
      );
      assert.ok(!connection.authenticated);
    } finally {
      await teardown(server, connection);
    }
  });

  test('authenticates with OAUTHBEARER including host and port', async () => {
    const { server, connection } = await setup({
      user: 'user@example.com',
      accessToken: 'the-access-token',
      method: 'oauthbearer',
    });
    try {
      await connection.connect();
      await connection.greeting();
      await connection.ehlo();
      await connection.authenticate();

      assert.ok(connection.authenticated);
      const command = server.getLastAuthCommand();
      assert.ok(command != null);
      assert.ok(command.startsWith('AUTH OAUTHBEARER '));
      const decoded = decodeAuthInitialResponse(command);
      assert.ok(decoded.startsWith('n,a=user@example.com,\x01'));
      assert.ok(decoded.includes('\x01host=localhost\x01'));
      assert.ok(decoded.includes(`\x01port=${server.getPort()}\x01`));
      assert.ok(decoded.endsWith('\x01auth=Bearer the-access-token\x01\x01'));
    } finally {
      await teardown(server, connection);
    }
  });

  test('rejects OAUTHBEARER failure via the 334 challenge continuation', async () => {
    const { server, connection } = await setup({
      user: 'user@example.com',
      accessToken: 'bad-token',
      method: 'oauthbearer',
    });
    server.setResponse('AUTH', { code: 535, message: '5.7.8 Bad credentials' });
    try {
      await connection.connect();
      await connection.greeting();
      await connection.ehlo();

      await assert.rejects(
        connection.authenticate(),
        (error) =>
          error instanceof SmtpAuthError &&
          /OAUTHBEARER/.test(error.message) &&
          // The "AQ==" continuation was accepted, so the final server reply is
          // the real failure rather than a rejected-continuation error.
          /Bad credentials/.test(error.message),
      );
      assert.ok(!connection.authenticated);
    } finally {
      await teardown(server, connection);
    }
  });

  test('auto-selects XOAUTH2 when method is omitted', async () => {
    const { server, connection } = await setup({
      user: 'user@example.com',
      accessToken: 'the-access-token',
    });
    try {
      await connection.connect();
      await connection.greeting();
      await connection.ehlo();
      await connection.authenticate();

      const command = server.getLastAuthCommand();
      assert.ok(command.startsWith('AUTH XOAUTH2 '));
    } finally {
      await teardown(server, connection);
    }
  });

  test('refuses OAuth over a cleartext non-loopback connection', async () => {
    const connection = new SmtpConnection({
      host: 'smtp.example.com',
      port: 25,
      secure: false,
      auth: { user: 'user@example.com', accessToken: 'the-access-token' },
    });
    // Simulate a post-EHLO plaintext connection without dialing out; the TLS
    // guard rejects before the socket is used.
    const socket = new Socket();
    connection.socket = socket;
    connection.capabilities = ['AUTH XOAUTH2'];
    try {
      await assert.rejects(
        connection.authenticate(),
        (error) => error instanceof SmtpAuthError && /TLS/.test(error.message),
      );
      assert.ok(!connection.authenticated);
    } finally {
      socket.destroy();
    }
  });

  test('throws SmtpAuthError when the server lacks AUTH support', async () => {
    const connection = new SmtpConnection({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'user@example.com', accessToken: 'the-access-token' },
    });
    const socket = new Socket();
    connection.socket = socket;
    connection.capabilities = []; // server advertised no AUTH mechanisms
    try {
      await assert.rejects(
        connection.authenticate(),
        (error) => error instanceof SmtpAuthError && /does not support/.test(error.message),
      );
    } finally {
      socket.destroy();
    }
  });
});
