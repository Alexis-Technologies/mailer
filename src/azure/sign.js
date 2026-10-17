// Ported from unemail v0.7.0 (src/drivers/_azure/sign.ts): the HMAC-SHA256
// signature of a request to Azure Communication Services, and the
// connection string of a resource.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the digests are the synchronous ones of node:crypto,
// the key decoded with `Buffer` rather than `atob`.

const { createHash, createHmac } = require('node:crypto');

// The header fields the signature covers, in its order.
const SIGNED_HEADERS = 'x-ms-date;host;x-ms-content-sha256';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Whether a string can be the base64 access key Azure issues.  A key that
 * does not decode signs every request wrong, which Azure answers with a bare
 * 401, so it is checked when the transport is made.
 *
 * @internal
 */
const isAccessKey = (value) =>
  typeof value === 'string' && value.length > 0 && value.length % 4 === 0 && BASE64.test(value);

/**
 * Signs a request: HMAC-SHA256 with the decoded key over its method, its
 * path and query, and the date, host and SHA-256 of its body, as
 * `HMAC-SHA256 SignedHeaders=…&Signature=…`.
 *
 * @param request `method`, `url`, `body` (a string, or none for a GET) and
 * `date`, the time of the request.
 * @param accessKey The base64 access key.
 * @returns The header fields to add: `x-ms-date`, `x-ms-content-sha256` and
 * `Authorization`.  Host is written by `fetch` from the URL.
 * @internal
 */
const signRequest = (request, accessKey) => {
  const url = new URL(request.url);
  // RFC 1123, which `toUTCString` writes.
  const date = request.date.toUTCString();
  const contentHash = createHash('sha256')
    .update(request.body ?? '', 'utf8')
    .digest('base64');
  const stringToSign =
    `${request.method.toUpperCase()}\n${url.pathname}${url.search}\n` +
    `${date};${url.host};${contentHash}`;
  const signature = createHmac('sha256', Buffer.from(accessKey, 'base64'))
    .update(stringToSign, 'utf8')
    .digest('base64');
  return {
    'x-ms-date': date,
    'x-ms-content-sha256': contentHash,
    Authorization: `HMAC-SHA256 SignedHeaders=${SIGNED_HEADERS}&Signature=${signature}`,
  };
};

/**
 * Splits the connection string the Keys blade of a resource shows,
 * `endpoint=https://….communication.azure.com/;accesskey=<base64>`.
 *
 * @param value The connection string.
 * @returns `{ endpoint, accessKey }`, or `undefined` if it is malformed.
 * @internal
 */
const parseConnectionString = (value) => {
  let endpoint = '';
  let accessKey = '';
  for (const part of value.split(';')) {
    const segment = part.trim();
    if (segment === '') continue;
    const at = segment.indexOf('=');
    if (at < 1) return undefined;
    const name = segment.slice(0, at).trim().toLowerCase();
    // Only the first `=` separates: a base64 key ends with one or two.
    const item = segment.slice(at + 1).trim();
    if (name === 'endpoint') endpoint = item;
    else if (name === 'accesskey') accessKey = item;
  }
  if (endpoint === '' || accessKey === '') return undefined;
  return { endpoint, accessKey };
};

module.exports = { isAccessKey, parseConnectionString, signRequest };
