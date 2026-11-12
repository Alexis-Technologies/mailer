// Ported from @parse/node-apn v8.1.1 (lib/client.js): one HTTP/2 session per
// origin, kept open and made anew when it goes away or closes, kept alive by
// pings on a timer that holds no process, and a request ended with
// NGHTTP2_CANCEL at its deadline.
// https://github.com/parse-community/node-apn — MIT, Copyright 2010 Andrew Naylor, Parse Platform
// Changed in the port: the session is behind a `fetch` of the WHATWG API, so
// the provider of APNs goes through createApiClient as every HTTP provider
// does; a session is held by the process only while a request is out on it;
// a ping that fails ends it, where node-apn logged it and kept the session; a
// stream the server refused, or left above the last of a GOAWAY, is marked
// as never sent (RFC 9113 §8.7), which a retry may send again; and the
// connection headers of HTTP/1.1, which HTTP/2 refuses, are left out.

const http2 = require('node:http2');
const { Readable } = require('node:stream');
const { abortReason } = require('./sleep.js');
const { markUnsent } = require('./unsent.js');

const { NGHTTP2_CANCEL, NGHTTP2_REFUSED_STREAM } = http2.constants;
const DEFAULT_PING_INTERVAL_MS = 60_000;
// Node's ping has no deadline: one a dead connection never answers would
// leave the session in use, every request on it timing out.
const DEFAULT_PING_TIMEOUT_MS = 10_000;
// The fields of HTTP/1.1 a request of HTTP/2 may not carry (RFC 9113 §8.2.2).
const CONNECTION_HEADERS = new Set([
  'connection',
  'host',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
]);
// The statuses of a response without a body, which a Response refuses one.
const NULL_BODY = new Set([204, 205, 304]);

const headersOf = (init) => {
  const headers = Object.create(null);
  for (const entry of new Headers(init)) {
    if (!CONNECTION_HEADERS.has(entry[0])) headers[entry[0]] = entry[1];
  }
  return headers;
};

const responseHeadersOf = (fields) => {
  const headers = new Headers();
  for (const name in fields) {
    if (name.startsWith(':')) continue;
    const value = fields[name];
    if (!Array.isArray(value)) headers.set(name, String(value));
    else for (const item of value) headers.append(name, item);
  }
  return headers;
};

// A session of an origin, with what its requests and its pings need.
class Session {
  active = 0;
  /** The last stream the server said it handles, after a GOAWAY. */
  lastStreamId = Infinity;
  #pinger;
  #pingTimer;
  #pingTimeoutMs;
  #log;
  #origin;

  constructor(origin, options, forget) {
    this.forget = forget;
    this.retired = false;
    this.#origin = origin;
    this.#log = options.log;
    this.#pingTimeoutMs = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
    this.handle = (options.connect ?? http2.connect)(origin, options.tls ?? {});
    // Not held until a request is out on it.
    this.handle.unref();
    const end = () => {
      clearInterval(this.#pinger);
      clearTimeout(this.#pingTimer);
      forget(this);
    };
    this.handle.on('goaway', (errorCode, lastStreamId) => {
      this.lastStreamId = lastStreamId;
      this.#tell('info', 'http2.goaway', { errorCode, lastStreamId });
      forget(this);
    });
    this.handle.on('close', end);
    this.handle.on('error', (error) => {
      this.#tell('warn', 'http2.session_failed', { code: error?.code });
      end();
    });
    this.handle.on('frameError', () => this.handle.destroy());
    this.#pinger = setInterval(
      () => this.ping(),
      options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS,
    );
    this.#pinger.unref();
  }

  #tell(level, message, fields) {
    this.#log?.write(
      level,
      () => ({ origin: this.#origin, active: this.active, ...fields }),
      message,
    );
  }

  /**
   * Pings the session, which is destroyed when the ping fails or goes
   * unanswered for `pingTimeoutMs`: a connection that died without a word,
   * behind a NAT that forgot it, answers nothing, and the requests on it
   * would each time out, of unknown delivery, until the system gave the
   * socket up minutes later. One ping at a time.
   */
  ping() {
    const handle = this.handle;
    // A session still connecting has no ping to answer: Node cancels it,
    // which is no failure of the session.
    if (handle.closed || handle.destroyed || handle.connecting) return;
    if (this.#pingTimer !== undefined) return;
    const timeoutMs = this.#pingTimeoutMs;
    const timer = setTimeout(() => {
      this.#pingTimer = undefined;
      this.#tell('warn', 'http2.ping_timeout', { timeoutMilliseconds: timeoutMs });
      handle.destroy(new Error(`The HTTP/2 session answered no ping within ${timeoutMs} ms.`));
    }, timeoutMs);
    timer.unref();
    this.#pingTimer = timer;
    const sent = handle.ping((error) => {
      clearTimeout(timer);
      this.#pingTimer = undefined;
      if (error !== null && error.code !== 'ERR_HTTP2_PING_CANCEL') handle.destroy(error);
    });
    // Too many pings unanswered: Node sends no more.
    if (sent === false) {
      clearTimeout(timer);
      this.#pingTimer = undefined;
      this.#tell('warn', 'http2.ping_timeout', { timeoutMilliseconds: timeoutMs });
      handle.destroy(new Error('The HTTP/2 session answered none of its last pings.'));
    }
  }

  get isUsable() {
    return (
      !this.retired &&
      !this.handle.closed &&
      !this.handle.destroyed &&
      this.lastStreamId === Infinity
    );
  }

  /**
   * Takes no more requests, those out on it let finish: a session whose ids
   * of streams ran out, after 2^30 requests, which Node keeps open.
   */
  retire() {
    if (this.retired) return;
    this.retired = true;
    this.#tell('info', 'http2.session_retired', {});
    this.forget(this);
    if (!this.handle.closed && !this.handle.destroyed) this.handle.close();
  }

  hold() {
    if (this.active++ === 0) this.handle.ref();
  }

  release() {
    if (--this.active === 0 && !this.handle.destroyed) this.handle.unref();
  }
}

// The failure of a stream: one the server refused, or left above the last
// stream of its GOAWAY, or that never had an id, never reached its handler.
// It is marked in an error of its own, as Node gives every stream of a
// session it destroys one error, which the streams the server handled share.
const streamFailure = (session, stream, error) => {
  if (error?.code === 'ERR_HTTP2_OUT_OF_STREAMS') session.retire();
  // A stream without an id never had its headers sent: the session failed,
  // or ran out of ids, before it.
  const refused =
    stream.id === undefined ||
    stream.rstCode === NGHTTP2_REFUSED_STREAM ||
    stream.id > session.lastStreamId;
  return refused
    ? markUnsent(new Error('The server took no HTTP/2 stream of this request.', { cause: error }))
    : error;
};

// One request on a session, as `fetch` makes it: its response once its
// headers come, its body read as it streams.
const requestOn = (session, url, init) =>
  new Promise((resolve, reject) => {
    const signal = init.signal ?? undefined;
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let stream;
    try {
      stream = session.handle.request({
        ...headersOf(init.headers),
        ':method': init.method ?? 'GET',
        ':path': `${url.pathname}${url.search}`,
      });
    } catch (error) {
      // A session that is going away takes no request: none was sent.
      reject(markUnsent(error));
      return;
    }
    session.hold();
    let settled = false;
    // At the deadline or the caller's abort: before the answer, the request
    // is cancelled; after it, the body being read fails with the reason.
    const onAbort = () => {
      if (settled) {
        stream.destroy(abortReason(signal));
        return;
      }
      settled = true;
      const sent = stream.id !== undefined;
      stream.close(NGHTTP2_CANCEL);
      if (sent) {
        // Sent and unanswered: the session may have died without a word,
        // which a ping tells at once rather than at its next interval.
        session.ping();
        reject(abortReason(signal));
        return;
      }
      // A stream without an id never had its headers sent, as the session
      // still connected: an abort of its own, marked unsent, so that the
      // reason of the signal, the caller's, is not.
      const unsent = new Error('The HTTP/2 request was aborted before it was sent.', {
        cause: abortReason(signal),
      });
      unsent.name = 'AbortError';
      reject(markUnsent(unsent));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    // A stream that closes without its headers, reset with no error among
    // them, ended without an answer; one that failed was told by 'error'.
    stream.on('close', () => {
      signal?.removeEventListener('abort', onAbort);
      session.release();
      if (!settled) {
        settled = true;
        reject(
          streamFailure(session, stream, new Error('The HTTP/2 stream closed with no response.')),
        );
      }
    });
    stream.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(streamFailure(session, stream, error));
      }
    });
    stream.on('response', (fields) => {
      if (settled) return;
      settled = true;
      const status = fields[':status'];
      // A Response takes no status beyond 200 to 599, which HTTP/2 may carry:
      // its error, thrown in this listener, would end the process.
      if (!(status >= 200 && status <= 599)) {
        stream.close(NGHTTP2_CANCEL);
        reject(new Error(`The server answered with the status ${status}, which is none of HTTP.`));
        return;
      }
      const hasBody = !NULL_BODY.has(status) && init.method !== 'HEAD';
      if (!hasBody) stream.resume();
      resolve(
        new Response(hasBody ? Readable.toWeb(stream) : null, {
          status,
          headers: responseHeadersOf(fields),
        }),
      );
    });
    stream.end(init.body ?? undefined);
  });

/**
 * Makes a `fetch` over HTTP/2, one session per origin, for an API that
 * speaks HTTP/2 alone (APNs), which Node's `fetch` does not.
 *
 * @param options `tls`, the options of the TLS connection (`ca`, …);
 * `maxSessions` (1), the sessions of one origin, a new one opened while every
 * one has a request out; `pingIntervalMs` (60 seconds); `pingTimeoutMs` (10
 * seconds), after which
 * an unanswered ping ends the session; `log`, of `internal/log.js`, told of
 * GOAWAYs, failed and unanswered pings and retired sessions; `connect`, in
 * place of `http2.connect`.
 * @returns `{ fetch(url, init), close() }`: `init` takes `method`,
 * `headers`, a body of a string or bytes, and `signal`; a redirect is never
 * followed, as HTTP/2 does not.
 * @internal
 */
const createHttp2Fetch = (options = {}) => {
  // The sessions of each origin, at most `maxSessions`: one by default, as
  // APNs takes a thousand streams on one, more for a sender of more.
  const maxSessions = options.maxSessions ?? 1;
  const sessions = new Map();
  const forget = (session) => {
    for (const pool of sessions.values()) pool.delete(session);
  };
  // The usable session with the fewest requests out, or a new one while the
  // origin has fewer than its most and every one is busy.
  const sessionOf = (origin) => {
    let pool = sessions.get(origin);
    if (pool === undefined) {
      pool = new Set();
      sessions.set(origin, pool);
    }
    let least;
    for (const session of pool) {
      if (!session.isUsable) {
        pool.delete(session);
        continue;
      }
      if (least === undefined || session.active < least.active) least = session;
    }
    if (least === undefined || (least.active > 0 && pool.size < maxSessions)) {
      least = new Session(origin, options, forget);
      pool.add(least);
    }
    return least;
  };
  return {
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      return requestOn(sessionOf(url.origin), url, init);
    },
    /** Closes every session, the requests out on them let finish. */
    close: async () => {
      const closing = [];
      for (const pool of sessions.values()) {
        for (const session of pool) {
          if (session.handle.closed || session.handle.destroyed) continue;
          closing.push(new Promise((resolve) => session.handle.close(resolve)));
        }
      }
      sessions.clear();
      await Promise.all(closing);
    },
  };
};

module.exports = { createHttp2Fetch };
