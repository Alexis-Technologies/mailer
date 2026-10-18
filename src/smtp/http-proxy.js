// Ported from nodemailer v10.0.16 (src/smtp-connection/http-proxy-client.ts):
// an SMTP connection tunneled through an HTTP or HTTPS proxy with CONNECT.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
// Changed in the port: a connector for the `connect` option, with a promise and
// a signal in place of a callback; an IPv6 destination is bracketed in the
// request line and Host field, which nodemailer wrote bare; an HTTPS proxy
// takes `ca` and the other TLS options and is sent its name for SNI, where
// nodemailer passed `rejectUnauthorized` alone; the credentials of the proxy URL
// are percent-decoded and encoded as UTF-8, and go to an `http:` proxy only on
// this machine unless the application allows them in clear; the socket is
// paused with what came after the reply put back, so a greeting sent at once
// is not lost; and `timeout` bounds the whole exchange, where a socket timeout
// bounded only each wait for a byte.

const { Buffer } = require('node:buffer');
const net = require('node:net');
const tls = require('node:tls');
const { isLoopbackHost } = require('../internal/loopback.js');
const { timerMs } = require('../internal/sleep.js');

// The most bytes of the reply to CONNECT before its blank line, so a proxy
// that never ends its header fields cannot fill the memory of the sender.
const MAX_REPLY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
// RFC 9110 §5.6.2: a field name is a token; a value holds no line break.
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const throwTypeError = (message) => {
  throw new TypeError(message);
};

const decodeCredential = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

// The header fields of the CONNECT request after its Host, one per line.
const headerLines = (url, headers) => {
  let lines = '';
  if (url.username !== '' || url.password !== '') {
    const credentials = `${decodeCredential(url.username)}:${decodeCredential(url.password)}`;
    lines += `Proxy-Authorization: Basic ${Buffer.from(credentials, 'utf8').toString('base64')}\r\n`;
  }
  if (headers == null) return lines;
  for (const name in headers) {
    if (!Object.hasOwn(headers, name)) continue;
    const value = headers[name];
    if (!TOKEN.test(name) || typeof value !== 'string' || /[\r\n\0]/.test(value)) {
      throwTypeError(`Invalid proxy header field: ${JSON.stringify(name)}`);
    }
    lines += `${name}: ${value}\r\n`;
  }
  return lines;
};

const parseProxyUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throwTypeError('The proxy URL is not a URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throwTypeError(`The proxy URL must be http or https: ${url.protocol}`);
  }
  return url;
};

const checkDestination = (host, port) => {
  if (typeof host !== 'string' || host === '' || /[\s\0]/.test(host)) {
    throwTypeError(`Invalid proxy destination host: ${JSON.stringify(host)}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throwTypeError(`Invalid proxy destination port: ${port}`);
  }
};

// The reply's status: `HTTP/1.x NNN`.
const statusOf = (head) => {
  const match = /^HTTP\/1\.[01] (\d{3})(?: |\r|$)/.exec(head);
  return match === null ? undefined : Number(match[1]);
};

const proxyError = (status, target) => {
  if (status === 407) {
    return new Error(`The proxy asks for authentication to reach ${target} (HTTP 407).`);
  }
  if (status === undefined) {
    return new Error(`The proxy did not answer CONNECT ${target} with an HTTP status line.`);
  }
  return new Error(`The proxy did not connect to ${target}: HTTP ${status}.`);
};

/**
 * Makes a connector for the `connect` option of `SmtpTransport` that opens
 * each connection through an HTTP or HTTPS proxy with `CONNECT`.
 *
 * @param options `url` of the proxy, with credentials for Basic authentication
 * if it needs them; `headers` to add to each CONNECT; `tls` options for an
 * HTTPS proxy; `timeout` of the CONNECT exchange (30 s, 0 for none); and
 * `allowPlaintextCredentials`, to send credentials to an `http:` proxy that is
 * not on this machine.
 * @returns The connector.
 * @throws {TypeError} If the URL is not http or https, a header is invalid, or
 * credentials would go in clear.
 */
const createHttpProxyConnector = (options) => {
  if (options == null || typeof options !== 'object') {
    throwTypeError('createHttpProxyConnector() needs { url }.');
  }
  const url = parseProxyUrl(options.url);
  const fields = headerLines(url, options.headers);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  if (typeof timeout !== 'number' || Number.isNaN(timeout) || timeout < 0) {
    throwTypeError(`Invalid proxy timeout: ${timeout}`);
  }
  const isHttps = url.protocol === 'https:';
  const proxyHost = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  // Basic credentials are the password itself: over plain HTTP, anyone on the
  // way to the proxy reads them, as the providers' keys are refused over it.
  const hasCredentials = url.username !== '' || url.password !== '';
  if (
    hasCredentials &&
    !isHttps &&
    !isLoopbackHost(proxyHost) &&
    options.allowPlaintextCredentials !== true
  ) {
    throwTypeError(
      'The credentials of an http:// proxy would go in clear: use an https:// proxy, or set ' +
        'allowPlaintextCredentials for a network where that is accepted.',
    );
  }
  const defaultPort = isHttps ? 443 : 80;
  const proxy = {
    isHttps,
    host: proxyHost,
    port: url.port === '' ? defaultPort : Number(url.port),
    tls: options.tls,
  };

  return async ({ host, port, localAddress, signal }) => {
    checkDestination(host, port);
    signal?.throwIfAborted();
    const target = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
    const request = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${fields}\r\n`;
    return tunnel(openSocket(proxy, localAddress), proxy.isHttps, request, target, timeout, signal);
  };
};

const openSocket = (proxy, localAddress) =>
  proxy.isHttps
    ? tls.connect({
        ...proxy.tls,
        host: proxy.host,
        port: proxy.port,
        servername: net.isIP(proxy.host) === 0 ? proxy.host.replace(/\.$/, '') : undefined,
        localAddress,
      })
    : net.connect({ host: proxy.host, port: proxy.port, localAddress });

// Sends the CONNECT request once the proxy is reached and reads its reply:
// the socket for a 2xx, paused, with what came after the reply put back.
const tunnel = (socket, isHttps, request, target, timeout, signal) =>
  new Promise((resolve, reject) => {
    const connected = isHttps ? 'secureConnect' : 'connect';
    const chunks = [];
    let received = 0;
    let tail = '';

    let timer;
    const cleanup = () => {
      socket.off(connected, onConnect);
      socket.off('data', onData);
      socket.off('error', fail);
      socket.off('close', onClose);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
    };
    const fail = (error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onAbort = () => fail(signal.reason);
    const onClose = () => fail(new Error(`The proxy closed the connection to ${target}.`));
    const onTimeout = () => fail(new Error(`The proxy timed out on CONNECT ${target}.`));
    const onConnect = () => socket.write(request);
    // Only the bytes that just came, and the three before them, are searched
    // for the end of the header fields.
    const onData = (chunk) => {
      const window = tail + chunk.toString('latin1');
      const end = window.indexOf('\r\n\r\n');
      chunks.push(chunk);
      received += chunk.length;
      tail = window.slice(-3);
      if (end === -1) {
        if (received > MAX_REPLY_BYTES) fail(proxyError(undefined, target));
        return;
      }
      const reply = Buffer.concat(chunks, received);
      const headEnd = received - window.length + end;
      const status = statusOf(reply.toString('latin1', 0, headEnd));
      if (status === undefined || status < 200 || status > 299) {
        fail(proxyError(status, target));
        return;
      }
      cleanup();
      // What the server sent with the reply, its greeting perhaps, waits in
      // the paused socket for the first reader.
      socket.pause();
      if (headEnd + 4 < received) socket.unshift(reply.subarray(headEnd + 4));
      resolve(socket);
    };

    socket.once(connected, onConnect);
    socket.on('data', onData);
    socket.once('error', fail);
    socket.once('close', onClose);
    // The whole exchange, not each wait for a byte: a proxy that answers a
    // byte at a time would hold a socket timeout off forever.
    if (timeout > 0 && timeout !== Number.POSITIVE_INFINITY) {
      timer = setTimeout(onTimeout, timerMs(timeout));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

module.exports = { createHttpProxyConnector };
