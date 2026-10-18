// Not ported: requests signed as Svix signs them
// (https://docs.svix.com/receiving/verifying-payloads/how-manual).

const { createHmac } = require('node:crypto');

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

const signSvix = (body, id = 'msg_1', timestamp = '1800000000', secret = SECRET) => {
  const key = Buffer.from(secret.slice(6), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    body,
    headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` },
  };
};

module.exports = { SECRET, signSvix };
