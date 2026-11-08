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

  constructor(origin, options, forget) {
    this.handle = (options.connect ?? http2.connect)(origin, options.tls ?? {});
    // Not held until a request is out on it.
    this.handle.unref();
    const end = () => {
      clearInterval(this.#pinger);
      forget(this);
    };
    this.handle.on('goaway', (errorCode, lastStreamId) => {
      this.lastStreamId = lastStreamId;
      forget(this);
    });
    this.handle.on('close', end);
    this.handle.on('error', end);
    this.handle.on('frameError', () => this.handle.destroy());
    this.#pinger = setInterval(() => {
      if (this.handle.closed || this.handle.destroyed) return;
      this.handle.ping((error) => {
        if (error !== null) this.handle.destroy(error);
      });
    }, options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS);
    this.#pinger.unref();
  }

  get isUsable() {
    return !this.handle.closed && !this.handle.destroyed && this.lastStreamId === Infinity;
  }

  hold() {
    if (this.active++ === 0) this.handle.ref();
  }

  release() {
    if (--this.active === 0 && !this.handle.destroyed) this.handle.unref();
  }
}

// The failure of a stream: one the server refused, or left above the last
// stream of its GOAWAY, never reached its handler. It is marked in an error
// of its own, as Node gives every stream of a session it destroys one error,
// which the streams the server handled share.
const streamFailure = (session, stream, error) => {
  const refused =
    stream.rstCode === NGHTTP2_REFUSED_STREAM ||
    (stream.id !== undefined && stream.id > session.lastStreamId);
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
      stream.close(NGHTTP2_CANCEL);
      reject(abortReason(signal));
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
 * `pingIntervalMs` (60 seconds); `connect`, in place of `http2.connect`.
 * @returns `{ fetch(url, init), close() }`: `init` takes `method`,
 * `headers`, a body of a string or bytes, and `signal`; a redirect is never
 * followed, as HTTP/2 does not.
 * @internal
 */
const createHttp2Fetch = (options = {}) => {
  const sessions = new Map();
  const forget = (session) => {
    for (const entry of sessions) {
      if (entry[1] === session) sessions.delete(entry[0]);
    }
  };
  const sessionOf = (origin) => {
    let session = sessions.get(origin);
    if (session === undefined || !session.isUsable) {
      session = new Session(origin, options, forget);
      sessions.set(origin, session);
    }
    return session;
  };
  return {
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      return requestOn(sessionOf(url.origin), url, init);
    },
    /** Closes every session, the requests out on them let finish. */
    close: async () => {
      const closing = [];
      for (const session of sessions.values()) {
        if (session.handle.closed || session.handle.destroyed) continue;
        closing.push(new Promise((resolve) => session.handle.close(resolve)));
      }
      sessions.clear();
      await Promise.all(closing);
    },
  };
};

module.exports = { createHttp2Fetch };
