// Ported from nodemailer v10.0.16 (src/mail-composer/index.ts): an attachment
// fetched from a URL, its file name taken from the path of the URL.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
// Changed in the port: the attachment is fetched once, when it is made,
// through the `fetch` passed in, over http and https only; every redirect is
// checked again and sends no header to another origin; time and bytes are
// bounded; and a loopback, private or link-local address is refused unless
// `allowUrl` says otherwise; and a redirect from https to http is refused,
// whatever `allowUrl` says.  nodemailer's own client followed five redirects
// with none of these checks, whatever the address.

const dns = require('node:dns');
const { readBytes } = require('../internal/body.js');
const { checkMaxBytes, createAttachment, mediaTypeOf } = require('./attachment.js');
const { DEFAULT_TYPE, extensionOfType, typeOfFilename } = require('./mime-types.js');
const { isPublicUrl, resolvesPublic } = require('../internal/public-url.js');
const { timerMs } = require('../internal/sleep.js');

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;

const parseHttpUrl = (value) => {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new TypeError(`Invalid attachment URL: ${JSON.stringify(String(value))}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError(`An attachment URL must be http or https: ${url.protocol}`);
  }
  return url;
};

// 0 and Infinity mean no timeout, as for the transports.
const checkTimeout = (value) => {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new TypeError(`timeout must be a non-negative number: ${value}`);
  }
  return value;
};

const signalOf = (timeout, signal) => {
  const timer =
    timeout === 0 || timeout === Number.POSITIVE_INFINITY
      ? undefined
      : AbortSignal.timeout(timerMs(timeout));
  if (timer === undefined) return signal;
  return signal == null ? timer : AbortSignal.any([timer, signal]);
};

// A decoded segment without the controls and separators a file name of a
// header or of the receiver's disk must not hold.
const withoutUnsafe = (name) => {
  let safe = '';
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f && code !== 0x2f && code !== 0x5c) safe += name[i];
  }
  return safe;
};

// The last segment of the path, as nodemailer names a file it fetched, with
// the extension of its type when it has none.
const filenameOf = (url, contentType) => {
  const path = url.pathname;
  let name = path.slice(path.lastIndexOf('/') + 1);
  try {
    name = decodeURIComponent(name);
  } catch {
    // Kept percent-encoded.
  }
  name = withoutUnsafe(name);
  if (name === '') name = 'attachment';
  return name.includes('.') ? name : `${name}.${extensionOfType(contentType)}`;
};

/**
 * Makes an attachment of what a URL answers, fetched now.
 *
 * @param input The http or https URL.
 * @param options `fetch`, `headers`, `signal`, `timeout` (30 s), `maxBytes`
 * (25 MiB), `maxRedirects` (5) and `allowUrl`, and the fields of the
 * attachment: by default the last segment of the path and the type the
 * server gives.
 * @returns The attachment, its content in memory.
 * @throws {TypeError} If the URL is not http or https, or a field is invalid.
 * @throws {RangeError} If a URL is not allowed (a redirect from https to http
 * never is), or the body is too long.
 * @throws {Error} If the server answers with an error or too many redirects.
 */
const fromUrl = async (input, options = {}) => {
  const fetch = options.fetch ?? globalThis.fetch;
  const maxBytes = checkMaxBytes(options.maxBytes);
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new TypeError(`maxRedirects must be a whole number: ${maxRedirects}`);
  }
  const lookup = options.lookup ?? dns.promises.lookup;
  if (typeof lookup !== 'function') throw new TypeError('lookup must be a function.');
  const allowUrl = options.allowUrl ?? ((url) => resolvesPublic(url, lookup));
  const signal = signalOf(checkTimeout(options.timeout), options.signal);
  const origin = parseHttpUrl(input).origin;
  let url = parseHttpUrl(input);
  for (let redirects = 0; ; redirects++) {
    if (!(await allowUrl(url))) {
      throw new RangeError(`The attachment URL is not allowed: ${url.origin}`);
    }
    // Headers such as Authorization go to the origin they were given for.
    const headers = url.origin === origin ? options.headers : undefined;
    const response = await fetch(url, { headers, redirect: 'manual', signal });
    if (REDIRECTS.has(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (location === null) throw new Error(`HTTP ${response.status} without a Location.`);
      if (redirects >= maxRedirects) throw new Error(`More than ${maxRedirects} redirects.`);
      const next = parseHttpUrl(new URL(location, url));
      // The request that led here was protected by TLS; the next would not be.
      if (url.protocol === 'https:' && next.protocol === 'http:') {
        throw new RangeError(
          `The attachment URL is not allowed: a redirect must not downgrade https to ${next.origin}`,
        );
      }
      url = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Fetching the attachment failed with HTTP ${response.status}.`);
    }
    const bytes = await readBytes(response, maxBytes);
    // A server that names no type, or only application/octet-stream, says
    // less than the extension of the file.
    const served = mediaTypeOf(response.headers.get('content-type')) ?? DEFAULT_TYPE;
    const filename = filenameOf(url, served);
    const named = typeOfFilename(options.filename ?? filename);
    return createAttachment(options, bytes, {
      filename,
      contentType: served === DEFAULT_TYPE ? named : served,
    });
  }
};

module.exports = { fromUrl, isPublicUrl };
