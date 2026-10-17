// Not ported: tests of the Scaleway, Lettermint, Maileroo, SMTP2GO and Azure
// verifiers of ./webhooks, against requests made as each provider documents.
const { test } = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('node:crypto');
const {
  createAzureWebhookVerifier,
  createLettermintWebhookVerifier,
  createMailerooWebhookVerifier,
  createScalewayWebhookVerifier,
  createSmtp2goWebhookVerifier,
  WebhookVerificationError,
} = require('../../src/webhooks/index.js');
const { certificate, certificateFetch, scaleway, signSns } = require('../helpers/webhooks/sns.js');

const rejects = async (promise, reason) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof WebhookVerificationError, String(error));
    assert.strictEqual(error.reason, reason, error.message);
    return true;
  });
};
const plain = (event) => ({ ...event, metadata: { ...event.metadata } });
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

const SCW_TOPIC = 'arn:scw:sns:fr-par:project-1:tem-events';
const SCW_CERT = 'https://messaging.s3.fr-par.scw.cloud/fr-par/sns/cert-1.pem';
const scwMessage = (record, fields = {}) =>
  signSns(
    {
      Type: 'Notification',
      MessageId: fields.MessageId ?? 'scw-1',
      TopicArn: SCW_TOPIC,
      Message: typeof record === 'string' ? record : JSON.stringify(record),
      Timestamp: '2027-01-01T12:00:00.000Z',
      SigningCertURL: SCW_CERT,
      ...fields,
    },
    '2',
    scaleway.privateKey,
  );

test('Webhooks Scaleway: an SNS message signed by a certificate the trust chain issued', async () => {
  const served = certificateFetch(scaleway.certificate);
  const verifier = createScalewayWebhookVerifier({
    topicArns: [SCW_TOPIC],
    trustChain: scaleway.trustChain,
    fetch: served.fetch,
    now: () => Date.parse('2027-01-01T12:00:30Z'),
  });
  const record = {
    id: 'ev-1',
    type: 'email_dropped',
    created_at: '2027-01-01T11:59:00Z',
    email_id: 'em-1',
    email_to: 'bob@example.com',
    email_headers: [
      { key: 'X-Metadata-orderId', value: '42' },
      { key: 'Subject', value: 'Hi' },
    ],
    email_response_code: 550,
    email_response_message: 'No such mailbox',
  };
  const { events } = await verifier.verify({ body: JSON.stringify(scwMessage(record)) });
  assert.deepStrictEqual(plain(events[0]), {
    provider: 'scaleway',
    type: 'bounced',
    id: 'ev-1',
    messageId: 'em-1',
    recipient: 'bob@example.com',
    occurredAt: new Date('2027-01-01T11:59:00Z'),
    bounce: { kind: 'hard', code: '550', diagnostic: 'No such mailbox' },
    tags: [],
    metadata: { orderId: '42' },
    raw: record,
  });
  for (const [type, expected] of [
    ['email_queued', 'accepted'],
    ['email_delivered', 'delivered'],
    ['email_deferred', 'deferred'],
    ['email_mailbox_not_found', 'bounced'],
    ['email_blocklisted', 'rejected'],
    ['email_spam', 'complained'],
    ['blocklist_created', 'unknown'],
  ]) {
    const message = scwMessage({ type, blocklist_type: 'mailbox_full' }, { MessageId: type });
    const result = await verifier.verify({ body: JSON.stringify(message) });
    assert.strictEqual(result.events[0].type, expected, type);
    assert.strictEqual(result.events[0].id, type);
  }
  const text = await verifier.verify({
    body: JSON.stringify(scwMessage('text', { MessageId: 'text' })),
  });
  assert.strictEqual(text.events[0].type, 'unknown');
  const subscription = signSns(
    {
      Type: 'SubscriptionConfirmation',
      MessageId: 'sub-1',
      Token: 't',
      TopicArn: SCW_TOPIC,
      Message: 'Confirm',
      SubscribeURL: 'https://sns.mnq.fr-par.scaleway.com/confirm?token=t',
      Timestamp: '2027-01-01T12:00:00.000Z',
      SigningCertURL: SCW_CERT,
    },
    '2',
    scaleway.privateKey,
  );
  const confirmed = await verifier.verify({ body: JSON.stringify(subscription) });
  assert.strictEqual(confirmed.confirmation.subscribeUrl, subscription.SubscribeURL);
  assert.strictEqual(served.requests.length, 1);
});

test('Webhooks Scaleway: a certificate the trust chain did not issue, or off Scaleway, is refused', async () => {
  // The SES test certificate is self-signed, not issued by the test CA.
  const foreign = createScalewayWebhookVerifier({
    topicArns: [SCW_TOPIC],
    trustChain: scaleway.trustChain,
    fetch: certificateFetch(certificate).fetch,
    now: () => Date.parse('2027-01-01T12:00:30Z'),
  });
  await rejects(
    foreign.verify({ body: JSON.stringify(scwMessage({ type: 'email_spam' })) }),
    'certificate',
  );
  const offHost = scwMessage(
    { type: 'email_spam' },
    { SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/c.pem' },
  );
  await rejects(foreign.verify({ body: JSON.stringify(offHost) }), 'certificate');
  assert.throws(
    () => createScalewayWebhookVerifier({ topicArns: [SCW_TOPIC] }),
    /trustChain is the PEM/,
  );
  assert.throws(
    () => createScalewayWebhookVerifier({ topicArns: [SCW_TOPIC], trustChain: 'no certificate' }),
    /holds no certificate/,
  );
  assert.throws(
    () => createScalewayWebhookVerifier({ trustChain: scaleway.trustChain }),
    /topicArns/,
  );
});

test('Webhooks Lettermint: the HMAC of the time and body, within a window, once', async () => {
  const secret = 'whsec_lettermint';
  const verifier = createLettermintWebhookVerifier({ secret, now: () => 1_800_000_000_000 });
  const sign = (body, t = '1800000000') => ({
    body,
    headers: {
      'X-Lettermint-Signature': `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`,
    },
  });
  const payload = {
    id: 'del-1',
    event: 'message.hard_bounced',
    timestamp: '2027-01-15T08:00:00Z',
    data: {
      message_id: 'lm-1',
      recipient: 'bob@example.com',
      response: { status_code: 550, enhanced_status_code: '5.1.1', content: 'unknown user' },
      metadata: { orderId: '42' },
      tag: 'welcome',
      tags: [],
    },
  };
  const body = JSON.stringify(payload);
  const { events } = await verifier.verify(sign(body));
  assert.deepStrictEqual(plain(events[0]), {
    provider: 'lettermint',
    type: 'bounced',
    id: 'del-1',
    messageId: 'lm-1',
    recipient: 'bob@example.com',
    occurredAt: new Date('2027-01-15T08:00:00Z'),
    bounce: { kind: 'hard', code: '5.1.1', diagnostic: 'unknown user' },
    tags: ['welcome'],
    metadata: { orderId: '42' },
    raw: payload,
  });
  await rejects(verifier.verify(sign(body)), 'replay');
  await rejects(verifier.verify({ body, headers: {} }), 'signature');
  await rejects(verifier.verify({ ...sign(body), body: body.replace('bob', 'eve') }), 'signature');
  await rejects(
    verifier.verify(sign(JSON.stringify({ ...payload, id: 'old' }), '1799990000')),
    'timestamp',
  );
  const cases = [
    ['message.created', 'accepted'],
    ['message.delivered', 'delivered'],
    ['message.soft_bounced', 'bounced'],
    ['message.spam_complaint', 'complained'],
    ['message.failed', 'rejected'],
    ['message.suppressed', 'rejected'],
    ['message.unsubscribed', 'unsubscribed'],
    ['message.opened', 'opened'],
    ['message.clicked', 'clicked'],
    ['webhook.test', 'unknown'],
  ];
  for (const [event, type] of cases) {
    const each = JSON.stringify({
      id: event,
      event,
      data: {
        tags: ['a', 'b'],
        destination_url: 'https://e.com',
        reason_code: 'enforced_tls_failed',
        response: { status_code: 421 },
      },
    });
    const result = await verifier.verify(sign(each));
    assert.strictEqual(result.events[0].type, type, event);
  }
  const soft = await verifier.verify(
    sign(JSON.stringify({ id: 'soft', event: 'message.soft_bounced', data: {} })),
  );
  assert.deepStrictEqual(soft.events[0].bounce, { kind: 'soft' });
  await rejects(verifier.verify(sign('[]')), 'payload');
  assert.throws(() => createLettermintWebhookVerifier({}), /secret/);
});

test('Webhooks Maileroo: the HMAC of the body, an event per recipient, once', async () => {
  const verifier = createMailerooWebhookVerifier({ secret: 'mr-secret' });
  const sign = (body) => ({
    body,
    headers: {
      'x-maileroo-signature': createHmac('sha256', 'mr-secret').update(body).digest('hex'),
    },
  });
  const payload = {
    event_id: 'ev-1',
    event_type: 'rejected',
    event_time: 1_800_000_000,
    message_id: '<x@maileroo>',
    message_reference_id: 'ref-1',
    tags: { tag1: 'orders', orderId: '42' },
    event_data: {
      from: ['shop@example.com'],
      to: ['bob@example.com', 'carol@example.com'],
      reject_reason: 'One or more of the recipients are on the suppression list.',
    },
  };
  const body = JSON.stringify(payload);
  const { events } = await verifier.verify(sign(body));
  assert.strictEqual(events.length, 2);
  assert.deepStrictEqual(plain(events[1]), {
    provider: 'maileroo',
    type: 'rejected',
    id: 'ev-1:1',
    messageId: 'ref-1',
    recipient: 'carol@example.com',
    occurredAt: new Date(1_800_000_000_000),
    reason: 'One or more of the recipients are on the suppression list.',
    tags: ['orders'],
    metadata: { orderId: '42' },
    raw: payload,
  });
  await rejects(verifier.verify(sign(body)), 'replay');
  const cases = [
    ['accepted', 'accepted'],
    ['delivered', 'delivered'],
    ['deferred', 'deferred'],
    ['failed', 'bounced'],
    ['complained', 'complained'],
    ['opened', 'opened'],
    ['clicked', 'clicked'],
    ['later', 'unknown'],
  ];
  for (const [eventType, type] of cases) {
    const each = JSON.stringify({
      event_id: eventType,
      event_type: eventType,
      tags: null,
      event_data: {
        to: 'bob@example.com',
        reason: 'mailbox full',
        original_url: 'https://e.com/a',
      },
    });
    const result = await verifier.verify(sign(each));
    assert.strictEqual(result.events[0].type, type, eventType);
  }
  const failed = await verifier.verify(
    sign(
      JSON.stringify({
        event_id: 'f2',
        event_type: 'failed',
        event_data: { to: 'b@example.com', reason: 'no user' },
      }),
    ),
  );
  assert.deepStrictEqual(failed.events[0].bounce, { kind: 'hard', diagnostic: 'no user' });
  const nobody = await verifier.verify(
    sign(JSON.stringify({ event_id: 'n', event_type: 'opened' })),
  );
  assert.strictEqual(nobody.events[0].recipient, undefined);
  await rejects(
    verifier.verify({ body, headers: { 'x-maileroo-signature': 'beef' } }),
    'signature',
  );
  await rejects(verifier.verify(sign('{}')), 'payload');
  assert.throws(() => createMailerooWebhookVerifier({}), /secret/);
});

test('Webhooks SMTP2GO: Basic credentials, a body of JSON or of a form', async () => {
  const verifier = createSmtp2goWebhookVerifier({ username: 'hook', password: 'pw' });
  const record = {
    event: 'bounce',
    email_id: '1abc-2def',
    rcpt: 'bob@example.com',
    time: '2027-01-15T08:00:00Z',
    bounce: 'hard',
    message: '550 unknown user',
    host: 'mx.example.com',
    'X-Metadata-orderId': '42',
  };
  const body = JSON.stringify(record);
  const { events } = await verifier.verify({
    body,
    headers: { authorization: basic('hook', 'pw') },
  });
  assert.deepStrictEqual(plain(events[0]), {
    provider: 'smtp2go',
    type: 'bounced',
    id: 'bounce:1abc-2def:bob@example.com:2027-01-15T08:00:00Z',
    messageId: '1abc-2def',
    recipient: 'bob@example.com',
    occurredAt: new Date('2027-01-15T08:00:00Z'),
    bounce: { kind: 'hard', diagnostic: '550 unknown user' },
    reason: '550 unknown user',
    tags: [],
    metadata: { orderId: '42' },
    raw: record,
  });
  await rejects(
    verifier.verify({ body, headers: { authorization: basic('hook', 'no') } }),
    'credentials',
  );
  const form = new URLSearchParams({
    event: 'click',
    email_id: 'e2',
    rcpt: 'carol@example.com',
    url: 'https://e.com/a',
    id: 'evt-9',
  }).toString();
  const clicked = await verifier.verify({
    body: form,
    headers: { authorization: basic('hook', 'pw') },
  });
  assert.strictEqual(clicked.events[0].type, 'clicked');
  assert.strictEqual(clicked.events[0].id, 'evt-9');
  assert.strictEqual(clicked.events[0].url, 'https://e.com/a');
  for (const [event, type] of [
    ['processed', 'accepted'],
    ['delivered', 'delivered'],
    ['reject', 'rejected'],
    ['spam', 'complained'],
    ['unsubscribe', 'unsubscribed'],
    ['open', 'opened'],
    ['resubscribe', 'unknown'],
  ]) {
    const each = await verifier.verify({
      body: JSON.stringify({ event }),
      headers: { authorization: basic('hook', 'pw') },
    });
    assert.strictEqual(each.events[0].type, type, event);
  }
  const soft = await verifier.verify({
    body: JSON.stringify({ event: 'bounce', bounce: 'soft' }),
    headers: { authorization: basic('hook', 'pw') },
  });
  assert.deepStrictEqual(soft.events[0].bounce, { kind: 'soft' });
  const unclear = await verifier.verify({
    body: JSON.stringify({ event: 'bounce' }),
    headers: { authorization: basic('hook', 'pw') },
  });
  assert.deepStrictEqual(unclear.events[0].bounce, { kind: 'undetermined' });
  await rejects(
    verifier.verify({ body: '{"event":', headers: { authorization: basic('hook', 'pw') } }),
    'payload',
  );
  await rejects(
    verifier.verify({ body: Buffer.from([0xff]), headers: { authorization: basic('hook', 'pw') } }),
    'payload',
  );
  await rejects(
    verifier.verify({ body: 'nothing=1', headers: { authorization: basic('hook', 'pw') } }),
    'payload',
  );
  assert.throws(() => createSmtp2goWebhookVerifier({}), /username is required/);
});

test('Webhooks Azure: Event Grid events with the token, and the validation handed back', async () => {
  const verifier = createAzureWebhookVerifier({ token: 'eg-token' });
  const validation = [
    {
      id: 'v-1',
      eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
      data: {
        validationCode: 'code-1',
        validationUrl: 'https://rp-eastus.eventgrid.azure.net/validate?x=1',
      },
    },
  ];
  const validated = await verifier.verify({
    body: JSON.stringify(validation),
    headers: { 'aeg-event-type': 'SubscriptionValidation' },
  });
  assert.deepStrictEqual(validated, {
    events: [],
    validation: { validationCode: 'code-1', validationUrl: validation[0].data.validationUrl },
  });
  await rejects(
    verifier.verify({
      body: '[{"eventType":"Other"}]',
      headers: { 'aeg-event-type': 'SubscriptionValidation' },
    }),
    'payload',
  );
  const report = {
    id: 'eg-1',
    eventType: 'Microsoft.Communication.EmailDeliveryReportReceived',
    eventTime: '2027-01-15T08:00:01Z',
    data: {
      sender: 'DoNotReply@example.com',
      recipient: 'bob@example.com',
      messageId: 'op-1',
      status: 'Bounced',
      deliveryStatusDetails: { statusMessage: '550 mailbox unavailable' },
      deliveryAttemptTimeStamp: '2027-01-15T08:00:00Z',
    },
  };
  const click = {
    id: 'eg-2',
    eventType: 'Microsoft.Communication.EmailEngagementTrackingReportReceived',
    data: {
      recipient: 'bob@example.com',
      messageId: 'op-1',
      engagementType: 'click',
      engagementContext: 'https://e.com/a',
      userActionTimeStamp: '2027-01-15T09:00:00Z',
    },
  };
  const body = JSON.stringify([report, click, { eventType: 'no id' }]);
  const headers = { 'aeg-event-type': 'Notification', Authorization: 'Bearer eg-token' };
  const { events } = await verifier.verify({ body, headers });
  assert.deepStrictEqual(plain(events[0]), {
    provider: 'azure',
    type: 'bounced',
    id: 'eg-1',
    messageId: 'op-1',
    recipient: 'bob@example.com',
    occurredAt: new Date('2027-01-15T08:00:00Z'),
    bounce: { kind: 'undetermined', diagnostic: '550 mailbox unavailable' },
    reason: '550 mailbox unavailable',
    tags: [],
    metadata: {},
    raw: report,
  });
  assert.strictEqual(events[1].type, 'clicked');
  assert.strictEqual(events[1].url, 'https://e.com/a');
  await rejects(verifier.verify({ body, headers }), 'replay');
  await rejects(
    verifier.verify({ body, headers: { 'aeg-event-type': 'Notification' } }),
    'credentials',
  );
  const statuses = ['Delivered', 'Failed', 'FilteredSpam', 'Suppressed', 'Quarantined', 'Expanded'];
  const many = [];
  for (const status of statuses) {
    many.push({
      id: `s-${status}`,
      eventType: 'Microsoft.Communication.EmailDeliveryReportReceived',
      data: { status },
    });
  }
  many.push({
    id: 's-view',
    eventType: 'Microsoft.Communication.EmailEngagementTrackingReportReceived',
    data: { engagementType: 'view' },
  });
  many.push({ id: 's-other', eventType: 'Microsoft.Communication.Other' });
  const typed = await verifier.verify({ body: JSON.stringify(many), headers });
  assert.deepStrictEqual(
    typed.events.map((event) => event.type),
    ['delivered', 'bounced', 'bounced', 'rejected', 'deferred', 'unknown', 'opened', 'unknown'],
  );
  await rejects(verifier.verify({ body: '{}', headers }), 'payload');
  const custom = createAzureWebhookVerifier({ token: 't', header: 'x-webhook-token' });
  const ok = await custom.verify({ body: '[]', headers: { 'x-webhook-token': 't' } });
  assert.deepStrictEqual(ok.events, []);
  assert.throws(() => createAzureWebhookVerifier({}), /token is required/);
});
