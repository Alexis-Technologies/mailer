// Not ported: SNS messages signed with the test certificate, as AWS signs them
// (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html).

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { sign } = require('node:crypto');

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'webhooks');
const certificate = readFileSync(path.join(FIXTURES, 'sns-cert.pem'), 'utf8');
const privateKey = readFileSync(path.join(FIXTURES, 'sns-key.pem'), 'utf8');

const TOPIC = 'arn:aws:sns:eu-west-1:123456789012:ses-events';
const CERT_URL = 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem';

// The name and value of each field, one per line, in the order AWS lists.
const NOTIFICATION = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'];
const SUBSCRIPTION = [
  'Message',
  'MessageId',
  'SubscribeURL',
  'Timestamp',
  'Token',
  'TopicArn',
  'Type',
];

const signSns = (message, version = '2') => {
  const fields = message.Type === 'Notification' ? NOTIFICATION : SUBSCRIPTION;
  let text = '';
  for (const field of fields) {
    if (message[field] !== undefined) text += `${field}\n${message[field]}\n`;
  }
  const algorithm = version === '1' ? 'RSA-SHA1' : 'RSA-SHA256';
  return {
    ...message,
    SignatureVersion: version,
    SigningCertURL: message.SigningCertURL ?? CERT_URL,
    Signature: sign(algorithm, Buffer.from(text, 'utf8'), privateKey).toString('base64'),
  };
};

const notification = (record, fields = {}) =>
  signSns({
    Type: 'Notification',
    MessageId: fields.MessageId ?? 'sns-1',
    TopicArn: TOPIC,
    Message: typeof record === 'string' ? record : JSON.stringify(record),
    Timestamp: fields.Timestamp ?? '2027-01-01T12:00:00.000Z',
    ...fields,
  });

// A fetch that serves the test certificate, and counts its requests.
const certificateFetch = () => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(certificate, { status: 200 });
  };
  return { fetch, requests };
};

module.exports = { CERT_URL, TOPIC, certificate, certificateFetch, notification, signSns };
