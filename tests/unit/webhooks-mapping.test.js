// Not ported: the mapping of every provider's events by the verifiers of
// ./webhooks to the type and bounce kind of a DeliveryEvent, one table per
// provider (docs/guide/webhooks.md): deferred when the provider tries again,
// bounced when it gave up after an attempt, hard, soft or undetermined as it
// says, rejected when it sent nothing, unknown for anything else.
const { test } = require('node:test');
const assert = require('node:assert');
const { createHmac, generateKeyPairSync, sign } = require('node:crypto');
const {
  createAzureWebhookVerifier,
  createBrevoWebhookVerifier,
  createLettermintWebhookVerifier,
  createMailerSendWebhookVerifier,
  createMailerooWebhookVerifier,
  createMailgunWebhookVerifier,
  createMailjetWebhookVerifier,
  createMailtrapWebhookVerifier,
  createPostmarkWebhookVerifier,
  createResendWebhookVerifier,
  createScalewayWebhookVerifier,
  createSendGridWebhookVerifier,
  createSesWebhookVerifier,
  createSmtp2goWebhookVerifier,
  createSparkPostWebhookVerifier,
} = require('../../src/webhooks/index.js');
const { SECRET, signSvix } = require('../helpers/webhooks/svix.js');
const {
  TOPIC,
  certificateFetch,
  notification,
  scaleway,
  signSns,
} = require('../helpers/webhooks/sns.js');

const NOW = 1_800_000_000_000;
const SNS_NOW = Date.parse('2027-01-01T12:00:30Z');
const hmac = (secret, body) => createHmac('sha256', secret).update(body).digest('hex');
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

// A row is [input, type, kind]: what the provider sends (its event name, or
// the fields that tell it apart), the type of the event and the kind of its
// bounce, absent when it has none.
const fieldsOf = (input, name) => (typeof input === 'string' ? { [name]: input } : input);
const expectedOf = (rows) => rows.map(([input, type, kind]) => [input, type, kind]);
const mappedOf = (input, event) => [input, event.type, event.bounce?.kind];

// The events of one request holding every row, in the order of the rows.
const batchOf = (rows, events) => events.map((event, index) => mappedOf(rows[index]?.[0], event));

// The events of one request per row; a row that gives several events, or
// none, shows in the diff.
const eachOf = async (rows, verify) => {
  const actual = [];
  for (let index = 0; index < rows.length; index++) {
    const input = rows[index][0];
    const { events } = await verify(input, index);
    for (const event of events) actual.push(mappedOf(input, event));
  }
  return actual;
};

test('Webhooks mapping: Brevo, by event, a bounce hard or soft by its name', async () => {
  const rows = [
    ['request', 'accepted'],
    ['sent', 'accepted'],
    ['delivered', 'delivered'],
    ['deferred', 'deferred'],
    ['hard_bounce', 'bounced', 'hard'],
    ['hardBounce', 'bounced', 'hard'],
    ['soft_bounce', 'bounced', 'soft'],
    ['softBounce', 'bounced', 'soft'],
    ['blocked', 'rejected'],
    ['invalid', 'rejected'],
    ['invalid_email', 'rejected'],
    ['error', 'rejected'],
    ['spam', 'complained'],
    ['complaint', 'complained'],
    ['unsubscribe', 'unsubscribed'],
    ['unsubscribed', 'unsubscribed'],
    ['opened', 'opened'],
    ['unique_opened', 'opened'],
    ['uniqueOpened', 'opened'],
    ['proxy_open', 'opened'],
    ['click', 'clicked'],
    ['unique_click', 'clicked'],
    ['list_addition', 'unknown'],
    ['no_such_event', 'unknown'],
  ];
  const verifier = createBrevoWebhookVerifier({ token: 'brevo-token' });
  const body = JSON.stringify(
    rows.map(([event], index) => ({
      event,
      email: 'bob@example.com',
      'message-id': `<m-${index}@example.com>`,
      ts_event: 1_800_000_000,
    })),
  );
  const { events } = await verifier.verify({
    body,
    headers: { Authorization: 'Bearer brevo-token' },
  });
  assert.deepStrictEqual(batchOf(rows, events), expectedOf(rows));
});

test('Webhooks mapping: Azure, by delivery status and engagement type', async () => {
  const rows = [
    [{ status: 'Delivered' }, 'delivered'],
    [{ status: 'Bounced' }, 'bounced', 'undetermined'],
    [{ status: 'Failed' }, 'bounced', 'undetermined'],
    [{ status: 'FilteredSpam' }, 'bounced', 'undetermined'],
    [{ status: 'Suppressed' }, 'rejected'],
    [{ status: 'Quarantined' }, 'unknown'],
    [{ status: 'Expanded' }, 'unknown'],
    [{ status: 'NoSuchStatus' }, 'unknown'],
    [{ engagementType: 'view' }, 'opened'],
    [{ engagementType: 'click' }, 'clicked'],
    [{ engagementType: 'forward' }, 'unknown'],
    [{ eventType: 'Microsoft.Communication.NoSuchEvent' }, 'unknown'],
  ];
  const recordOf = ({ status, engagementType, eventType }, index) => {
    const id = `az-${index}`;
    if (status !== undefined) {
      return {
        id,
        eventType: 'Microsoft.Communication.EmailDeliveryReportReceived',
        data: { status, messageId: 'op-1', recipient: 'bob@example.com' },
      };
    }
    if (engagementType !== undefined) {
      return {
        id,
        eventType: 'Microsoft.Communication.EmailEngagementTrackingReportReceived',
        data: { engagementType, messageId: 'op-1', recipient: 'bob@example.com' },
      };
    }
    return { id, eventType, data: {} };
  };
  const verifier = createAzureWebhookVerifier({ token: 'eg-token', replayStore: null });
  const { events } = await verifier.verify({
    body: JSON.stringify(rows.map(([input], index) => recordOf(input, index))),
    headers: { 'aeg-event-type': 'Notification', Authorization: 'Bearer eg-token' },
  });
  assert.deepStrictEqual(batchOf(rows, events), expectedOf(rows));
});

test('Webhooks mapping: Lettermint, by event, a bounce hard or soft by its name', async () => {
  const rows = [
    ['message.created', 'accepted'],
    ['message.sent', 'accepted'],
    ['message.delivered', 'delivered'],
    ['message.hard_bounced', 'bounced', 'hard'],
    ['message.soft_bounced', 'bounced', 'soft'],
    ['message.spam_complaint', 'complained'],
    ['message.failed', 'rejected'],
    ['message.suppressed', 'rejected'],
    ['message.policy_rejected', 'rejected'],
    ['message.unsubscribed', 'unsubscribed'],
    ['message.opened', 'opened'],
    ['message.clicked', 'clicked'],
    ['message.no_such_event', 'unknown'],
  ];
  const secret = 'whsec_lettermint';
  const verifier = createLettermintWebhookVerifier({ secret, now: () => NOW, replayStore: null });
  const actual = await eachOf(rows, (event, index) => {
    const body = JSON.stringify({
      id: `lm-${index}`,
      event,
      timestamp: '2027-01-15T08:00:00Z',
      data: { message_id: 'lm-msg-1', recipient: 'bob@example.com' },
    });
    const t = '1800000000';
    return verifier.verify({
      body,
      headers: { 'X-Lettermint-Signature': `t=${t},v1=${hmac(secret, `${t}.${body}`)}` },
    });
  });
  assert.deepStrictEqual(actual, expectedOf(rows));
});

test('Webhooks mapping: MailerSend, by activity, a bounce hard or soft by its name', async () => {
  const rows = [
    ['activity.sent', 'accepted'],
    ['activity.delivered', 'delivered'],
    ['activity.deferred', 'deferred'],
    ['activity.soft_bounced', 'bounced', 'soft'],
    ['activity.hard_bounced', 'bounced', 'hard'],
    ['activity.suppressed', 'rejected'],
    ['activity.spam_complaint', 'complained'],
    ['activity.unsubscribed', 'unsubscribed'],
    ['activity.opened', 'opened'],
    ['activity.opened_unique', 'opened'],
    ['activity.clicked', 'clicked'],
    ['activity.clicked_unique', 'clicked'],
    ['activity.no_such_event', 'unknown'],
  ];
  const verifier = createMailerSendWebhookVerifier({ secret: 'ms-secret', replayStore: null });
  const actual = await eachOf(rows, (type, index) => {
    const body = JSON.stringify({
      type,
      created_at: '2027-01-15T08:00:00.000000Z',
      data: { id: `act-${index}`, message_id: 'msg-1', recipient: 'bob@example.com' },
    });
    return verifier.verify({ body, headers: { Signature: hmac('ms-secret', body) } });
  });
  assert.deepStrictEqual(actual, expectedOf(rows));
});

test('Webhooks mapping: Mailgun, a failure by its severity and reason', async () => {
  const failed = (fields) => ({ event: 'failed', ...fields });
  const rows = [
    ['accepted', 'accepted'],
    ['delivered', 'delivered'],
    [failed({ severity: 'temporary' }), 'deferred', 'soft'],
    [failed({ severity: 'temporary', reason: 'generic' }), 'deferred', 'soft'],
    [failed({ severity: 'permanent' }), 'bounced', 'hard'],
    [failed({ severity: 'permanent', reason: 'old' }), 'bounced', 'hard'],
    // A failure that gives no severity does not say which it is.
    ['failed', 'bounced', 'undetermined'],
    [failed({ severity: 'permanent', reason: 'suppress-bounce' }), 'rejected'],
    [failed({ severity: 'permanent', reason: 'suppress-unsubscribe' }), 'rejected'],
    [failed({ severity: 'permanent', reason: 'suppress-complaint' }), 'rejected'],
    ['rejected', 'rejected'],
    ['complained', 'complained'],
    ['unsubscribed', 'unsubscribed'],
    ['opened', 'opened'],
    ['clicked', 'clicked'],
    ['stored', 'unknown'],
    ['no_such_event', 'unknown'],
  ];
  const key = 'key-mailgun-signing';
  const verifier = createMailgunWebhookVerifier({
    signingKey: key,
    now: () => NOW,
    replayStore: null,
  });
  const actual = await eachOf(rows, (input, index) => {
    const timestamp = '1800000000';
    const token = `token-${index}`;
    const body = JSON.stringify({
      signature: { timestamp, token, signature: hmac(key, timestamp + token) },
      'event-data': {
        id: `mg-${index}`,
        timestamp: 1_799_999_990,
        recipient: 'bob@example.com',
        message: { headers: { 'message-id': '20270115.1@mg.example.com' } },
        ...fieldsOf(input, 'event'),
      },
    });
    return verifier.verify({ body, headers: {} });
  });
  assert.deepStrictEqual(actual, expectedOf(rows));
});

test('Webhooks mapping: Maileroo, by event, a failure of a kind not said', async () => {
  // Changed after the review: a failure was hard and a deferral soft though
  // Maileroo says neither; a deferral with its reason carries a soft bounce.
  const rows = [
    ['accepted', 'accepted'],
    ['delivered', 'delivered'],
    ['deferred', 'deferred'],
    [{ event_type: 'deferred', reason: '421 try later' }, 'deferred', 'soft'],
    ['failed', 'bounced', 'undetermined'],
    ['rejected', 'rejected'],
    ['complained', 'complained'],
    ['opened', 'opened'],
    ['clicked', 'clicked'],
    ['no_such_event', 'unknown'],
  ];
  const verifier = createMailerooWebhookVerifier({ secret: 'mr-secret', replayStore: null });
  const actual = await eachOf(rows, (input, index) => {
    const fields = typeof input === 'string' ? { event_type: input } : input;
    const body = JSON.stringify({
      event_id: `mr-${index}`,
      event_type: fields.event_type,
      event_time: 1_800_000_000,
      message_reference_id: 'ref-1',
      event_data: { to: 'bob@example.com', reason: fields.reason },
    });
    return verifier.verify({
      body,
      headers: { 'x-maileroo-signature': hmac('mr-secret', body) },
    });
  });
  assert.deepStrictEqual(actual, expectedOf(rows));
});

test('Webhooks mapping: Mailjet, a bounce hard or soft by hard_bounce', async () => {
  const rows = [
    ['sent', 'delivered'],
    [{ event: 'bounce', hard_bounce: true }, 'bounced', 'hard'],
    [{ event: 'bounce', hard_bounce: false }, 'bounced', 'soft'],
    // A bounce that does not say is undetermined.
    ['bounce', 'bounced', 'undetermined'],
    ['blocked', 'rejected'],
    ['spam', 'complained'],
    ['unsub', 'unsubscribed'],
    ['open', 'opened'],
    ['click', 'clicked'],
    ['no_such_event', 'unknown'],
  ];
  const verifier = createMailjetWebhookVerifier({ username: 'mj', password: 'pw' });
  const body = JSON.stringify(
    rows.map(([input], index) => ({
      email: 'bob@example.com',
      time: 1_800_000_000,
      MessageID: index,
      ...fieldsOf(input, 'event'),
    })),
  );
  const { events } = await verifier.verify({ body, headers: { authorization: basic('mj', 'pw') } });
  assert.deepStrictEqual(batchOf(rows, events), expectedOf(rows));
});

test('Webhooks mapping: Postmark, a bounce by its Type', async () => {
  const bounce = (Type) => ({ RecordType: 'Bounce', Type });
  const change = (fields) => ({ RecordType: 'SubscriptionChange', ...fields });
  const rows = [
    ['Delivery', 'delivered'],
    ['SpamComplaint', 'complained'],
    ['Open', 'opened'],
    ['Click', 'clicked'],
    [bounce('HardBounce'), 'bounced', 'hard'],
    [bounce('BadEmailAddress'), 'bounced', 'hard'],
    [bounce('DMARCPolicy'), 'bounced', 'hard'],
    [bounce('SoftBounce'), 'bounced', 'soft'],
    [bounce('DnsError'), 'bounced', 'soft'],
    [bounce('Blocked'), 'bounced', 'soft'],
    [bounce('Transient'), 'deferred', 'soft'],
    [bounce('SpamComplaint'), 'complained'],
    [bounce('SpamNotification'), 'complained'],
    [bounce('Unsubscribe'), 'unsubscribed'],
    [bounce('ManuallyDeactivated'), 'rejected'],
    [bounce('SMTPApiError'), 'rejected'],
    [bounce('TemplateRenderingFailed'), 'rejected'],
    [bounce('AutoResponder'), 'unknown'],
    [bounce('AddressChange'), 'unknown'],
    [bounce('Subscribe'), 'unknown'],
    [bounce('ChallengeVerification'), 'unknown'],
    [bounce('InboundError'), 'unknown'],
    // The bounces Postmark cannot classify.
    [bounce('Unknown'), 'bounced', 'undetermined'],
    [bounce('Unconfirmed'), 'bounced', 'undetermined'],
    // Notices that follow no attempt, and a type Postmark does not document.
    [bounce('VirusNotification'), 'unknown'],
    [bounce('OpenRelayTest'), 'unknown'],
    [bounce('NoSuchBounce'), 'unknown'],
    [{ RecordType: 'Bounce' }, 'bounced', 'undetermined'],
    // Only a suppression by hand or by a link is an unsubscribe; one after a
    // bounce or a complaint followed that event.
    [change({ SuppressSending: true }), 'unknown'],
    [change({ SuppressSending: true, SuppressionReason: 'ManualSuppression' }), 'unsubscribed'],
    [change({ SuppressSending: true, SuppressionReason: 'HardBounce' }), 'unknown'],
    [change({ SuppressSending: true, SuppressionReason: 'SpamComplaint' }), 'unknown'],
    [change({ SuppressSending: false }), 'unknown'],
    ['NoSuchRecord', 'unknown'],
  ];
  const verifier = createPostmarkWebhookVerifier({ username: 'hook', password: 's3cret' });
  const actual = await eachOf(rows, (input, index) =>
    verifier.verify({
      body: JSON.stringify({
        ID: index,
        MessageID: 'pm-1',
        Recipient: 'bob@example.com',
        ...fieldsOf(input, 'RecordType'),
      }),
      headers: { Authorization: basic('hook', 's3cret') },
    }),
  );
  assert.deepStrictEqual(actual, expectedOf(rows));
});

test('Webhooks mapping: Mailtrap, by event, a bounce hard or soft by its name', async () => {
  const rows = [
    ['delivery', 'delivered'],
    ['soft bounce', 'bounced', 'soft'],
    ['bounce', 'bounced', 'hard'],
    ['suspension', 'rejected'],
    ['reject', 'rejected'],
    ['spam', 'complained'],
    ['unsubscribe', 'unsubscribed'],
    ['open', 'opened'],
    ['click', 'clicked'],
    ['no_such_event', 'unknown'],
  ];
  const verifier = createMailtrapWebhookVerifier({ secret: 'mt-secret', replayStore: null });
  const body = JSON.stringify({
    events: rows.map(([event], index) => ({
      event,
      event_id: `mt-${index}`,
      message_id: 'mt-msg-1',
      email: 'bob@example.com',
      timestamp: 1_800_000_000,
    })),
  });
  const { events } = await verifier.verify({
    body,
    headers: { 'Mailtrap-Signature': hmac('mt-secret', body) },
  });
  assert.deepStrictEqual(batchOf(rows, events), expectedOf(rows));
});

test('Webhooks mapping: Resend, a bounce by the type SES gives it', async () => {
  const bounced = (bounce) => ({ type: 'email.bounced', bounce });
  const rows = [
    ['email.sent', 'accepted'],
    ['email.scheduled', 'accepted'],
    ['email.delivered', 'delivered'],
    ['email.delivery_delayed', 'deferred'],
    [bounced({ type: 'Permanent' }), 'bounced', 'hard'],
    [bounced({ type: 'Transient' }), 'bounced', 'soft'],
    [bounced({ type: 'Undetermined' }), 'bounced', 'undetermined'],
    [bounced({ message: 'no type' }), 'bounced', 'undetermined'],
    // With no bounce object, the bounce does not say its kind.
    ['email.bounced', 'bounced', 'undetermined'],
    ['email.failed', 'rejected'],
    ['email.suppressed', 'rejected'],
    ['email.complained', 'complained'],
    ['email.opened', 'opened'],
    ['email.clicked', 'clicked'],
    ['contact.created', 'unknown'],
    ['email.no_such_event', 'unknown'],
  ];
  const verifier = createResendWebhookVerifier({
    secret: SECRET,
    now: () => NOW,
    replayStore: null,
  });
  const actual = await eachOf(rows, (input, index) => {
    const { type, ...data } = fieldsOf(input, 'type');
    const body = JSON.stringify({
      type,
      created_at: '2027-01-15T08:00:00.000Z',
      data: { email_id: 'e-1', to: ['bob@example.com'], ...data },
    });
    return verifier.verify(signSvix(body, `msg_${index}`));
  });
  assert.deepStrictEqual(actual, expectedOf(rows));
});

test('Webhooks mapping: SendGrid, a bounce hard, soft when blocked or expired', async () => {
  const bounce = (type) => ({ event: 'bounce', type });
  const rows = [
    ['processed', 'accepted'],
    ['delivered', 'delivered'],
    ['deferred', 'deferred'],
    [bounce('bounce'), 'bounced', 'hard'],
    [bounce('blocked'), 'bounced', 'soft'],
    // Expired: given up after its retries.
    [bounce('expired'), 'bounced', 'soft'],
    ['bounce', 'bounced', 'undetermined'],
    ['dropped', 'rejected'],
    ['spamreport', 'complained'],
    ['unsubscribe', 'unsubscribed'],
    ['group_unsubscribe', 'unsubscribed'],
    ['open', 'opened'],
    ['click', 'clicked'],
    ['group_resubscribe', 'unknown'],
    ['no_such_event', 'unknown'],
  ];
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const verifier = createSendGridWebhookVerifier({
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    now: () => NOW,
    replayStore: null,
  });
  const body = JSON.stringify(
    rows.map(([input], index) => ({
      email: 'bob@example.com',
      timestamp: 1_799_999_990,
      sg_event_id: `sg-${index}`,
      sg_message_id: 'x-msg-1.filter-1',
      ...fieldsOf(input, 'event'),
    })),
  );
  const timestamp = '1800000000';
  const { events } = await verifier.verify({
    body,
    headers: {
      'X-Twilio-Email-Event-Webhook-Signature': sign(
        'sha256',
        Buffer.from(timestamp + body),
        privateKey,
      ).toString('base64'),
      'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
    },
  });
  assert.deepStrictEqual(batchOf(rows, events), expectedOf(rows));
});

test('Webhooks mapping: Scaleway, by type, a drop hard and a deferral soft', async () => {
  const rows = [
    ['email_queued', 'accepted'],
    ['email_delivered', 'delivered'],
    // Changed after the review: a deferral carries a soft bounce only with its
    // code or reason.
    ['email_deferred', 'deferred'],
    ['email_dropped', 'bounced', 'hard'],
    ['email_mailbox_not_found', 'bounced', 'hard'],
    ['email_blocklisted', 'rejected'],
    ['email_spam', 'complained'],
    ['email_no_such_event', 'unknown'],
  ];
  const topic = 'arn:scw:sns:fr-par:project-1:tem-events';
  const verifier = createScalewayWebhookVerifier({
    topicArns: [topic],
    trustChain: scaleway.trustChain,
    fetch: certificateFetch(scaleway.certificate).fetch,
    now: () => SNS_NOW,
    replayStore: null,
  });
  const actual = await eachOf(rows, (type, index) => {
    const message = signSns(
      {
        Type: 'Notification',
        MessageId: `scw-${index}`,
        TopicArn: topic,
        Message: JSON.stringify({
          id: `scw-event-${index}`,
          type,
          created_at: '2027-01-01T11:59:00Z',
          email_id: 'em-1',
          email_to: 'bob@example.com',
        }),
        Timestamp: '2027-01-01T12:00:00.000Z',
        SigningCertURL: 'https://messaging.s3.fr-par.scw.cloud/fr-par/sns/cert-1.pem',
      },
      '2',
      scaleway.privateKey,
    );
    return verifier.verify({ body: JSON.stringify(message) });
  });
  assert.deepStrictEqual(actual, expectedOf(rows));
});

test('Webhooks mapping: SES, by event type, a bounce by its bounceType', async () => {
  const BOB = [{ emailAddress: 'bob@example.com' }];
  const bounce = (fields) => ({
    eventType: 'Bounce',
    bounce: { bouncedRecipients: BOB, ...fields },
  });
  const subscription = (unsubscribeAll) => ({
    eventType: 'Subscription',
    subscription: { newTopicPreferences: { unsubscribeAll } },
  });
  const rows = [
    [{ eventType: 'Send' }, 'accepted'],
    [{ eventType: 'Delivery', delivery: { recipients: ['bob@example.com'] } }, 'delivered'],
    [bounce({ bounceType: 'Permanent' }), 'bounced', 'hard'],
    [bounce({ bounceType: 'Transient' }), 'bounced', 'soft'],
    [bounce({ bounceType: 'Undetermined' }), 'bounced', 'undetermined'],
    [bounce({}), 'bounced', 'undetermined'],
    // A bounce that names no recipient gives one event, of its kind.
    [{ eventType: 'Bounce', bounce: { bounceType: 'Permanent' } }, 'bounced', 'hard'],
    [{ eventType: 'Complaint', complaint: { complainedRecipients: BOB } }, 'complained'],
    [{ eventType: 'DeliveryDelay', deliveryDelay: { delayedRecipients: BOB } }, 'deferred'],
    [{ eventType: 'Reject', reject: { reason: 'Bad content' } }, 'rejected'],
    [{ eventType: 'Rendering Failure', failure: { errorMessage: 'No name' } }, 'rejected'],
    // SES writes it with a space; the name without is not one of its types.
    [{ eventType: 'RenderingFailure' }, 'unknown'],
    [{ eventType: 'Open' }, 'opened'],
    [{ eventType: 'Click', click: { link: 'https://example.com/a' } }, 'clicked'],
    [subscription(true), 'unsubscribed'],
    [subscription(false), 'unknown'],
    // The notifications of an identity, rather than of a configuration set.
    [
      { notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: BOB } },
      'bounced',
      'hard',
    ],
    [{ notificationType: 'Complaint', complaint: { complainedRecipients: BOB } }, 'complained'],
    [{ notificationType: 'Delivery', delivery: { recipients: ['bob@example.com'] } }, 'delivered'],
    [{ eventType: 'NoSuchEvent' }, 'unknown'],
  ];
  const verifier = createSesWebhookVerifier({
    topicArns: [TOPIC],
    fetch: certificateFetch().fetch,
    now: () => SNS_NOW,
    replayStore: null,
  });
  const actual = await eachOf(rows, (input, index) => {
    const record = {
      mail: {
        timestamp: '2027-01-01T11:59:00.000Z',
        messageId: 'ses-message-1',
        destination: ['bob@example.com'],
      },
      ...input,
    };
    const message = notification(record, { MessageId: `sns-${index}` });
    return verifier.verify({ body: JSON.stringify(message), headers: {} });
  });
  assert.deepStrictEqual(actual, expectedOf(rows));
});

test('Webhooks mapping: SMTP2GO, a bounce by its bounce field', async () => {
  const bounce = (kind) => ({ event: 'bounce', bounce: kind });
  const rows = [
    ['processed', 'accepted'],
    ['delivered', 'delivered'],
    [bounce('hard'), 'bounced', 'hard'],
    [bounce('soft'), 'bounced', 'soft'],
    [bounce('other'), 'bounced', 'undetermined'],
    ['bounce', 'bounced', 'undetermined'],
    ['reject', 'rejected'],
    ['spam', 'complained'],
    ['unsubscribe', 'unsubscribed'],
    ['open', 'opened'],
    ['click', 'clicked'],
    ['resubscribe', 'unknown'],
    ['no_such_event', 'unknown'],
  ];
  const verifier = createSmtp2goWebhookVerifier({ username: 'hook', password: 'pw' });
  const actual = await eachOf(rows, (input) =>
    verifier.verify({
      body: JSON.stringify({
        email_id: '1abc-2def',
        rcpt: 'bob@example.com',
        time: '2027-01-15T08:00:00Z',
        ...fieldsOf(input, 'event'),
      }),
      headers: { authorization: basic('hook', 'pw') },
    }),
  );
  assert.deepStrictEqual(actual, expectedOf(rows));
});

test('Webhooks mapping: SparkPost, a bounce by its bounce class', async () => {
  const classed = (type, bounceClass) => ({ type, bounce_class: bounceClass });
  const rows = [
    ['injection', 'accepted'],
    ['delivery', 'delivered'],
    ['delay', 'deferred'],
    // A delay carries no bounce, whatever its class.
    [classed('delay', '20'), 'deferred'],
    [classed('bounce', '10'), 'bounced', 'hard'],
    [classed('bounce', 30), 'bounced', 'hard'],
    // Changed after the review: 90 was a hard bounce, 25 and 26 soft ones, 60,
    // 80 and 100 soft ones, though they are an unsubscribe, refusals by
    // SparkPost's policy, and no failure.
    [classed('bounce', '90'), 'unsubscribed'],
    [classed('bounce', '25'), 'rejected'],
    [classed('bounce', '26'), 'rejected'],
    [classed('bounce', '60'), 'unknown'],
    [classed('bounce', '80'), 'unknown'],
    [classed('bounce', '100'), 'unknown'],
    [classed('bounce', '20'), 'bounced', 'soft'],
    [classed('bounce', '50'), 'bounced', 'soft'],
    [classed('bounce', '70'), 'bounced', 'soft'],
    [classed('bounce', '1'), 'bounced', 'undetermined'],
    ['bounce', 'bounced', 'undetermined'],
    [classed('out_of_band', '10'), 'bounced', 'hard'],
    [classed('out_of_band', '20'), 'bounced', 'soft'],
    ['out_of_band', 'bounced', 'undetermined'],
    ['spam_complaint', 'complained'],
    ['policy_rejection', 'rejected'],
    ['generation_failure', 'rejected'],
    ['generation_rejection', 'rejected'],
    ['list_unsubscribe', 'unsubscribed'],
    ['link_unsubscribe', 'unsubscribed'],
    ['open', 'opened'],
    ['initial_open', 'opened'],
    ['amp_open', 'opened'],
    ['amp_initial_open', 'opened'],
    ['click', 'clicked'],
    ['amp_click', 'clicked'],
    ['no_such_event', 'unknown'],
  ];
  const verifier = createSparkPostWebhookVerifier({ username: 'sp', password: 'pw' });
  const body = JSON.stringify(
    rows.map(([input], index) => ({
      msys: {
        message_event: {
          event_id: `sp-${index}`,
          transmission_id: 't-1',
          rcpt_to: 'bob@example.com',
          ...fieldsOf(input, 'type'),
        },
      },
    })),
  );
  const { events } = await verifier.verify({ body, headers: { Authorization: basic('sp', 'pw') } });
  assert.deepStrictEqual(batchOf(rows, events), expectedOf(rows));
});

test('Webhooks mapping: the Message-ID a provider reports, and the correlationId of metadata', async () => {
  // Before: an event carried no correlationId, and the guide sent a message
  // of unknown delivery to rfcMessageId, which the HTTP APIs write themselves.
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const sendgrid = createSendGridWebhookVerifier({
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    now: () => NOW,
    replayStore: null,
  });
  const sgBody = JSON.stringify([
    {
      email: 'bob@example.com',
      timestamp: 1_799_999_990,
      sg_event_id: 'sg-c',
      event: 'delivered',
      'smtp-id': '<sg-1@example.com>',
      correlationId: 'order-1',
    },
  ]);
  const sgSignature = sign('sha256', Buffer.from(`1800000000${sgBody}`), privateKey).toString(
    'base64',
  );
  const fromSendGrid = await sendgrid.verify({
    body: sgBody,
    headers: {
      'X-Twilio-Email-Event-Webhook-Signature': sgSignature,
      'X-Twilio-Email-Event-Webhook-Timestamp': '1800000000',
    },
  });
  const mailersend = createMailerSendWebhookVerifier({ secret: 'ms-secret', replayStore: null });
  const msBody = JSON.stringify({
    type: 'activity.delivered',
    created_at: '2027-01-15T08:00:00.000000Z',
    data: {
      id: 'ms-c',
      email: {
        headers: [
          { name: 'Message-ID', value: '<ms-1@example.com>' },
          { name: 'X-Metadata-correlationId', value: 'order-2' },
        ],
      },
    },
  });
  const fromMailerSend = await mailersend.verify({
    body: msBody,
    headers: { signature: hmac('ms-secret', msBody) },
  });
  const smtp2go = createSmtp2goWebhookVerifier({ username: 'hook', password: 'pw' });
  const fromSmtp2go = await smtp2go.verify({
    body: JSON.stringify({
      event: 'delivered',
      email_id: '1abc',
      rcpt: 'bob@example.com',
      'Message-Id': '<s2g-1@example.com>',
      'X-Metadata-correlationId': 'order-3',
    }),
    headers: { authorization: basic('hook', 'pw') },
  });
  const topic = 'arn:scw:sns:fr-par:project-1:tem-events';
  const scw = createScalewayWebhookVerifier({
    topicArns: [topic],
    trustChain: scaleway.trustChain,
    fetch: certificateFetch(scaleway.certificate).fetch,
    now: () => SNS_NOW,
    replayStore: null,
  });
  const fromScaleway = await scw.verify({
    body: JSON.stringify(
      signSns(
        {
          Type: 'Notification',
          MessageId: 'scw-c',
          TopicArn: topic,
          Message: JSON.stringify({
            id: 'scw-event-c',
            type: 'email_delivered',
            email_headers: [
              { key: 'Message-Id', value: '<scw-1@example.com>' },
              { key: 'X-Metadata-correlationId', value: 'order-4' },
            ],
          }),
          Timestamp: '2027-01-01T12:00:00.000Z',
          SigningCertURL: 'https://messaging.s3.fr-par.scw.cloud/fr-par/sns/cert-1.pem',
        },
        '2',
        scaleway.privateKey,
      ),
    ),
  });
  const read = (delivery) => [delivery.events[0].rfcMessageId, delivery.events[0].correlationId];
  assert.deepStrictEqual([fromSendGrid, fromMailerSend, fromSmtp2go, fromScaleway].map(read), [
    ['<sg-1@example.com>', 'order-1'],
    ['<ms-1@example.com>', 'order-2'],
    ['<s2g-1@example.com>', 'order-3'],
    ['<scw-1@example.com>', 'order-4'],
  ]);
});
