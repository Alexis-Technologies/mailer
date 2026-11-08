// Not ported: ./apns on the node:http2 of the runtime that runs the test
// (Node, Bun or Deno), with no mock, against a local HTTP/2 server over TLS,
// its certificate trusted by the test CA.
const { test } = require('node:test');
const assert = require('node:assert');
const http2 = require('node:http2');
const { generateKeyPairSync } = require('node:crypto');
const { createChannelMessage } = require('@alexify/mailer/channels');
const { ApnsTransport } = require('@alexify/mailer/apns');
const { ca, credentials } = require('../helpers/smtp/servers.js');

const DEVICE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

// A server of APNs that answers each push as `answer(headers, body)` says.
const apnsServer = async (t, answer) => {
  const pushes = [];
  const sessions = new Set();
  const server = http2.createSecureServer(credentials);
  server.on('session', (session) => {
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
  });
  server.on('stream', (stream, headers) => {
    stream.on('error', () => {});
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => (body += chunk));
    stream.on('end', () => {
      pushes.push({ headers, body });
      const [status, reply] = answer(headers, body);
      stream.respond({
        ':status': status,
        'apns-id': headers['apns-id'],
        'content-type': 'application/json',
      });
      stream.end(reply === undefined ? '' : JSON.stringify(reply));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        for (const session of sessions) session.destroy();
        server.close(() => resolve());
      }),
  );
  return { url: `https://localhost:${server.address().port}`, pushes };
};

const transport = (baseUrl) =>
  new ApnsTransport({
    teamId: 'TEAM123456',
    keyId: 'KEY1234567',
    privateKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    topic: 'com.example.app',
    environment: 'sandbox',
    baseUrl,
    tls: { ca },
    retries: 0,
  });

const push = (text) =>
  createChannelMessage({ channel: 'push', to: { token: DEVICE }, title: 'Hello', text });

test('Runtime APNs: pushes go over one HTTP/2 session with TLS, a refusal by its reason', async (t) => {
  const server = await apnsServer(t, (headers, body) =>
    JSON.parse(body).aps.alert.body === 'gone' ? [410, { reason: 'Unregistered' }] : [200],
  );
  const apns = transport(server.url);
  t.after(() => apns[Symbol.asyncDispose]());
  const sent = await apns.send(push('first'));
  assert.strictEqual(sent.successful, true);
  assert.strictEqual(sent.messageId, server.pushes[0].headers['apns-id']);
  assert.strictEqual(server.pushes[0].headers[':path'], `/3/device/${DEVICE}`);
  assert.strictEqual(server.pushes[0].headers['apns-topic'], 'com.example.app');
  assert.match(server.pushes[0].headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  const gone = await apns.send(push('gone'));
  assert.strictEqual(gone.successful, false);
  assert.strictEqual(gone.errors[0].category, 'unregistered');
  assert.strictEqual(gone.errors[0].code, 'apns.Unregistered');
  assert.strictEqual(server.pushes.length, 2);
});
