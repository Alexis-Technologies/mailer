// Ported from upyo v0.7.0 (packages/smtp/src/smtp-connection-lifecycle.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Socket } = require('node:net');
const { SmtpConnection } = require('../../src/smtp/smtp-connection.js');

for (const event of ['timeout', 'close']) {
  test(`settles a stalled TCP connect promptly on ${event}`, async () => {
    const connection = new SmtpConnection({
      host: 'localhost',
      port: 25,
      connectionTimeout: 1000,
      socketTimeout: 50,
    });
    const connect = Socket.prototype.connect;
    let pending;
    // Isolate the handshake without depending on a network blackhole.
    Socket.prototype.connect = function () {
      return this;
    };
    try {
      pending = connection.connect();
    } finally {
      Socket.prototype.connect = connect;
    }
    let settled = false;
    const checked = assert.rejects(pending, (error) => {
      assert.ok(error instanceof Error);
      if (event === 'timeout') assert.match(error.message, /Socket timeout/);
      settled = true;
      return true;
    });
    connection.socket.emit(event);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(settled, 'The connect promise still waits for connectionTimeout.');
    } finally {
      connection.socket?.destroy();
      await checked;
      await connection.quit();
    }
  });
}

test('cancels a stalled TCP connect with the original reason', async () => {
  const connection = new SmtpConnection({
    host: 'localhost',
    port: 25,
    connectionTimeout: 5000,
  });
  const connect = Socket.prototype.connect;
  const controller = new AbortController();
  let pending;
  Socket.prototype.connect = function () {
    return this;
  };
  try {
    pending = connection.connect(controller.signal);
  } finally {
    Socket.prototype.connect = connect;
  }
  const checked = assert.rejects(pending, (e) => e === 'cancel TCP');
  controller.abort('cancel TCP');
  try {
    await checked;
    assert.ok(connection.socket?.destroyed);
  } finally {
    await connection.quit();
  }
});
