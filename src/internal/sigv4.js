// Ported from upyo v0.7.0 (packages/ses/src/http-client.ts): the AWS Signature
// Version 4 of its SES client, for any service of AWS (SES, End User Messaging
// SMS), with the signing key derived once a day rather than per request.
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createHash, createHmac } = require('node:crypto');

const ALGORITHM = 'AWS4-HMAC-SHA256';

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

// A name or a value of the query as SigV4 encodes it: every byte but the
// unreserved characters of RFC 3986, which encodeURIComponent leaves `!'()*`
// of too.
const RESERVED = /[!'()*]/g;
const encodeQueryPart = (text) =>
  encodeURIComponent(text).replace(
    RESERVED,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const compareParts = (left, right) => {
  if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
  if (left[1] === right[1]) return 0;
  return left[1] < right[1] ? -1 : 1;
};

// The canonical query of a URL: its parameters encoded and sorted by name,
// then value, on a line of their own, not after the path.
const canonicalQueryOf = (searchParams) => {
  const parts = [];
  for (const entry of searchParams) {
    parts.push([encodeQueryPart(entry[0]), encodeQueryPart(entry[1])]);
  }
  parts.sort(compareParts);
  let query = '';
  for (let index = 0; index < parts.length; index++) {
    query += `${index > 0 ? '&' : ''}${parts[index][0]}=${parts[index][1]}`;
  }
  return query;
};

/**
 * Makes a signer of AWS Signature Version 4 for one region.
 *
 * @param region The region of the requests, such as `us-east-1`.
 * @param defaultService The service a request goes to unless the call names
 * another, such as `ses`.
 * @returns `sign(url, { method, headers, body }, credentials, service)`,
 * which gives the headers of the request with `Host`, `X-Amz-Date`, the
 * session token when there is one, and `Authorization`, at the time of the
 * call.
 * @internal
 */
const createSigV4Signer = (region, defaultService) => {
  let cached = null;
  // The signing key depends only on the secret and the scope (a day, a
  // region, a service), so it is derived once a day rather than per request.
  const signingKeyOf = (secretAccessKey, credentialScope) => {
    if (cached?.scope === credentialScope && cached.secretAccessKey === secretAccessKey) {
      return cached.key;
    }
    let key = `AWS4${secretAccessKey}`;
    for (const part of credentialScope.split('/')) {
      key = createHmac('sha256', key).update(part).digest();
    }
    cached = { scope: credentialScope, secretAccessKey, key };
    return key;
  };
  return (url, options, credentials, service = defaultService) => {
    const parsedUrl = new URL(url);
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);

    const host = parsedUrl.host;
    const path = parsedUrl.pathname;
    const query = canonicalQueryOf(parsedUrl.searchParams);

    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    headers.set('Host', host);
    headers.set('X-Amz-Date', amzDate);

    if (credentials.sessionToken) {
      headers.set('X-Amz-Security-Token', credentials.sessionToken);
    }

    const signedHeaders =
      'host;x-amz-date' + (credentials.sessionToken ? ';x-amz-security-token' : '');
    const canonicalHeaders =
      `host:${host}\nx-amz-date:${amzDate}\n` +
      (credentials.sessionToken ? `x-amz-security-token:${credentials.sessionToken}\n` : '');

    const payloadHash = sha256Hex(options.body || '');
    const canonicalRequest = `${method}\n${path}\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `${ALGORITHM}\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

    const signingKey = signingKeyOf(credentials.secretAccessKey, credentialScope);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    headers.set(
      'Authorization',
      `${ALGORITHM} Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    );
    return headers;
  };
};

module.exports = { createSigV4Signer };
