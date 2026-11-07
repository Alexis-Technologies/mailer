// Ported from upyo v0.7.0 (packages/ses/src/http-client.ts): the AWS Signature
// Version 4 of its SES client, for any service of AWS (SES, End User Messaging
// SMS), with the signing key derived once a day rather than per request.
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createHash, createHmac } = require('node:crypto');

const ALGORITHM = 'AWS4-HMAC-SHA256';

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

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
    const path = parsedUrl.pathname + parsedUrl.search;

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
    const canonicalRequest = `${method}\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

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
