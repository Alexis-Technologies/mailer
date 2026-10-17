// Not ported: local servers for the SMTP tests: an SMTP server that answers a
// whole transaction over plain TCP (with AUTH offered in clear), implicit TLS
// or STARTTLS, and an HTTP or HTTPS proxy that tunnels CONNECT.
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

// A certificate issued by a test CA: Bun takes no self-signed certificate
// that is not a CA as a root of trust.
const credentials = {
  key: fs.readFileSync(path.join(__dirname, '../../fixtures/tls/server-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, '../../fixtures/tls/server-cert.pem')),
};
const ca = [fs.readFileSync(path.join(__dirname, '../../fixtures/tls/ca-cert.pem'), 'utf8')];

const listen = (server, host = '127.0.0.1') =>
  new Promise((resolve) => server.listen(0, host, () => resolve(server.address().port)));
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });

// An SMTP server answering a whole transaction; `mode` is 'plain' (with AUTH
// offered in clear), 'implicit' or 'starttls'.
const smtpServer = async (t, mode = 'plain') => {
  // `data` holds each message as it came after DATA, dot-stuffing undone.
  const state = { commands: [], messages: 0, data: [], sockets: new Set() };
  const handle = (socket, upgraded) => {
    state.sockets.add(socket);
    socket.on('error', () => {});
    if (!upgraded) socket.write('220 ready\r\n');
    let buffer = '';
    let inData = false;
    let lines = [];
    const onData = (bytes) => {
      buffer += bytes.toString('latin1');
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            state.messages++;
            state.data.push(lines.join('\r\n') + '\r\n');
            lines = [];
            socket.write('250 queued\r\n');
          } else {
            lines.push(line.startsWith('.') ? line.slice(1) : line);
          }
          continue;
        }
        state.commands.push(line);
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO') {
          const extra = mode === 'starttls' && !upgraded ? 'STARTTLS' : 'AUTH PLAIN';
          socket.write(`250-hello\r\n250 ${extra}\r\n`);
        } else if (verb === 'STARTTLS') {
          socket.off('data', onData);
          socket.write('220 go\r\n');
          const secure = new tls.TLSSocket(socket, { isServer: true, ...credentials });
          handle(secure, true);
          return;
        } else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go\r\n');
        } else if (verb === 'QUIT') {
          socket.end('221 bye\r\n');
        } else if (verb === 'AUTH') {
          socket.write('235 ok\r\n');
        } else {
          socket.write('250 ok\r\n');
        }
      }
    };
    socket.on('data', onData);
  };
  const server =
    mode === 'implicit'
      ? tls.createServer(credentials, (socket) => handle(socket, false))
      : net.createServer((socket) => handle(socket, false));
  const port = await listen(server);
  t.after(() => {
    for (const socket of state.sockets) socket.destroy();
    return close(server);
  });
  return { port, state };
};

// An HTTP proxy that tunnels CONNECT to 127.0.0.1, or answers as `reply` says.
const proxyServer = async (t, { secure = false, reply } = {}) => {
  const requests = [];
  // A socket handed over to 'connect' is no longer the server's to close,
  // and an HTTP server keeps it half open after the client leaves.
  const tunnels = new Set();
  const server = secure ? https.createServer(credentials) : http.createServer();
  server.on('connect', (request, client, head) => {
    requests.push({ url: request.url, headers: request.headers });
    tunnels.add(client);
    client.on('error', () => {});
    if (reply !== undefined) {
      reply(request, client);
      return;
    }
    const port = Number(request.url.slice(request.url.lastIndexOf(':') + 1));
    const upstream = net.connect(port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
  });
  const port = await listen(server);
  t.after(() => {
    for (const tunnel of tunnels) tunnel.destroy();
    return close(server);
  });
  return { port, requests, url: `${secure ? 'https' : 'http'}://127.0.0.1:${port}` };
};

module.exports = { ca, credentials, close, listen, proxyServer, smtpServer };
