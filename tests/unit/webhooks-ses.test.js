// Not ported: tests of the SES verifier of ./webhooks, ported from sently's SES
// webhook, with SNS messages signed by a test certificate.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  createMemoryReplayStore,
  createSesWebhookVerifier,
  WebhookVerificationError,
} = require('../../src/webhooks/index.js');
const {
  CERT_URL,
  TOPIC,
  certificateFetch,
  notification,
  signSns,
} = require('../helpers/webhooks/sns.js');
const { storeKey } = require('../helpers/webhooks/store.js');

const NOW = Date.parse('2027-01-01T12:00:30Z');
const verifier = (options = {}) => {
  const served = certificateFetch();
  const made = createSesWebhookVerifier({
    topicArns: [TOPIC],
    fetch: served.fetch,
    now: () => NOW,
    replayStore: createMemoryReplayStore({ now: () => NOW }),
    ...options,
  });
  return { ...made, requests: served.requests };
};
const request = (message) => ({ body: JSON.stringify(message), headers: {} });
const mail = (fields = {}) => ({
  timestamp: '2026-10-17T11:59:00.000Z',
  messageId: 'ses-message-1',
  destination: ['bob@example.com', 'carol@example.com'],
  tags: {
    category: ['orders', 'eu'],
    orderId: ['42'],
    priority: ['high'],
    'ses:configuration-set': ['events'],
  },
  ...fields,
});

const rejects = async (promise, reason) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof WebhookVerificationError, String(error));
    assert.strictEqual(error.reason, reason, error.message);
    return true;
  });
};

test('Webhooks SES: a bounce is an event per recipient, hard or soft', async () => {
  const { verify, requests } = verifier();
  const record = {
    eventType: 'Bounce',
    mail: mail(),
    bounce: {
      bounceType: 'Permanent',
      bounceSubType: 'General',
      timestamp: '2026-10-17T12:00:00.000Z',
      bouncedRecipients: [
        {
          emailAddress: 'bob@example.com',
          status: '5.1.1',
          diagnosticCode: 'smtp; 550 5.1.1 unknown',
        },
        { emailAddress: 'carol@example.com' },
      ],
    },
  };
  const { events } = await verify(request(notification(record)));
  // Changed in the port: sently made one event, of the first recipient.
  assert.strictEqual(events.length, 2);
  assert.deepStrictEqual(
    { ...events[0], metadata: { ...events[0].metadata } },
    {
      provider: 'ses',
      type: 'bounced',
      id: 'sns-1:0',
      messageId: 'ses-message-1',
      recipient: 'bob@example.com',
      occurredAt: new Date('2026-10-17T12:00:00.000Z'),
      bounce: { kind: 'hard', code: '5.1.1', diagnostic: 'smtp; 550 5.1.1 unknown' },
      reason: 'General',
      tags: ['orders', 'eu'],
      metadata: { orderId: '42' },
      raw: record,
    },
  );
  assert.deepStrictEqual(events[1].bounce, { kind: 'hard' });
  assert.strictEqual(events[1].id, 'sns-1:1');
  assert.deepStrictEqual(requests[0].url, CERT_URL);
  assert.strictEqual(requests[0].init.redirect, 'error');
  const soft = await verify(
    request(
      notification(
        { ...record, bounce: { ...record.bounce, bounceType: 'Transient' } },
        { MessageId: 'sns-2' },
      ),
    ),
  );
  assert.strictEqual(soft.events[0].bounce.kind, 'soft');
  const unclear = await verify(
    request(
      notification(
        { ...record, bounce: { ...record.bounce, bounceType: 'Undetermined' } },
        { MessageId: 'sns-3' },
      ),
    ),
  );
  assert.strictEqual(unclear.events[0].bounce.kind, 'undetermined');
  // The certificate was read once.
  assert.strictEqual(requests.length, 1);
});

test('Webhooks SES: every type of SES event', async () => {
  const { verify } = verifier();
  const cases = [
    [{ eventType: 'Send', mail: mail() }, ['accepted', 'accepted']],
    [
      {
        notificationType: 'Delivery',
        mail: mail(),
        delivery: { recipients: ['bob@example.com'], timestamp: '2026-10-17T12:00:01Z' },
      },
      ['delivered'],
    ],
    [
      {
        eventType: 'Complaint',
        mail: mail(),
        complaint: {
          complaintFeedbackType: 'abuse',
          complainedRecipients: [{ emailAddress: 'bob@example.com' }],
        },
      },
      ['complained'],
    ],
    [
      {
        eventType: 'DeliveryDelay',
        mail: mail(),
        deliveryDelay: {
          delayType: 'MailboxFull',
          delayedRecipients: [{ emailAddress: 'bob@example.com' }],
        },
      },
      ['deferred'],
    ],
    // Changed in the port: sently counted these as bounces.
    [
      { eventType: 'Reject', mail: mail(), reject: { reason: 'Bad content' } },
      ['rejected', 'rejected'],
    ],
    [
      {
        eventType: 'Rendering Failure',
        mail: mail(),
        failure: { errorMessage: 'Missing variable' },
      },
      ['rejected', 'rejected'],
    ],
    [
      {
        eventType: 'Open',
        mail: mail({ destination: ['bob@example.com'] }),
        open: { timestamp: '2026-10-17T12:00:02Z' },
      },
      ['opened'],
    ],
    [{ eventType: 'Click', mail: mail(), click: { link: 'https://example.com/a' } }, ['clicked']],
    [
      {
        eventType: 'Subscription',
        mail: mail(),
        subscription: { newTopicPreferences: { unsubscribeAll: true } },
      },
      ['unsubscribed'],
    ],
    [{ eventType: 'Subscription', mail: mail(), subscription: {} }, ['unknown']],
    [{ eventType: 'Something new', mail: mail({ tags: undefined }) }, ['unknown']],
    [{ eventType: 'Bounce', mail: mail({ messageId: undefined }) }, ['bounced']],
  ];
  for (let i = 0; i < cases.length; i++) {
    const [record, types] = cases[i];
    const { events } = await verify(request(notification(record, { MessageId: `sns-${i}` })));
    assert.deepStrictEqual(
      events.map((event) => event.type),
      types,
      record.eventType ?? record.notificationType,
    );
  }
  const click = await verify(request(notification(cases[7][0], { MessageId: 'click' })));
  assert.strictEqual(click.events[0].url, 'https://example.com/a');
  // A click names no recipient when the message had two.
  assert.strictEqual(click.events[0].recipient, undefined);
  const reject = await verify(request(notification(cases[4][0], { MessageId: 'reject' })));
  assert.strictEqual(reject.events[1].reason, 'Bad content');
  const delay = await verify(request(notification(cases[3][0], { MessageId: 'delay' })));
  assert.strictEqual(delay.events[0].reason, 'MailboxFull');
  const plain = await verify(
    request(notification('not json', { MessageId: 'text', Subject: 'Test' })),
  );
  assert.strictEqual(plain.events[0].type, 'unknown');
});

test('Webhooks SES: a subscription is verified and handed back, not confirmed', async () => {
  const { verify, requests } = verifier();
  const message = signSns({
    Type: 'SubscriptionConfirmation',
    MessageId: 'sub-1',
    Token: 'token-1',
    TopicArn: TOPIC,
    Message: 'You have chosen to subscribe',
    SubscribeURL: 'https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=token-1',
    Timestamp: '2027-01-01T12:00:00.000Z',
  });
  const result = await verify(request(message));
  assert.deepStrictEqual(
    { events: result.events, confirmation: result.confirmation },
    {
      events: [],
      confirmation: {
        type: 'SubscriptionConfirmation',
        topicArn: TOPIC,
        subscribeUrl: message.SubscribeURL,
        token: 'token-1',
        message: 'You have chosen to subscribe',
      },
    },
  );
  // Only the certificate was fetched: the subscription is the caller's to confirm.
  assert.strictEqual(requests.length, 1);
  const elsewhere = signSns({
    ...message,
    MessageId: 'sub-2',
    SubscribeURL: 'https://evil.example/confirm',
  });
  await rejects(verify(request(elsewhere)), 'payload');
});

test('Webhooks SES: a forged, foreign, old or repeated message is refused', async () => {
  // Changed in the port: sently verified nothing.
  const { verify } = verifier();
  const good = notification({ eventType: 'Send', mail: mail() });
  await rejects(verify(request({ ...good, Message: '{"eventType":"Delivery"}' })), 'signature');
  await rejects(verify(request({ ...good, TopicArn: 'arn:aws:sns:eu-west-1:999:other' })), 'topic');
  await rejects(
    verify(request({ ...good, SigningCertURL: 'https://evil.example/cert.pem' })),
    'certificate',
  );
  await rejects(
    verify(request({ ...good, SigningCertURL: 'http://sns.eu-west-1.amazonaws.com/cert.pem' })),
    'certificate',
  );
  await rejects(verify(request({ ...good, SigningCertURL: 'not a url' })), 'certificate');
  await rejects(verify(request({ ...good, SignatureVersion: '3' })), 'signature');
  await rejects(
    verify(
      request(
        notification(
          { eventType: 'Send', mail: mail() },
          { MessageId: 'old', Timestamp: '2027-01-01T10:00:00.000Z' },
        ),
      ),
    ),
    'timestamp',
  );
  const taken = await verify(request(good));
  assert.strictEqual(taken.events.length, 2);
  await taken.commit();
  await rejects(verify(request(good)), 'replay');
  const sha1 = signSns(
    { ...notification({ eventType: 'Send', mail: mail() }, { MessageId: 'v1' }) },
    '1',
  );
  assert.strictEqual((await verify(request(sha1))).events.length, 2);
  await rejects(verify(request({ ...good, Type: 'Other' })), 'payload');
  await rejects(verify({ body: '[]', headers: {} }), 'payload');
  await rejects(verify({ body: 'not json' }), 'payload');
  await rejects(verify({ body: Buffer.from([0xff, 0xfe]) }), 'payload');
  await rejects(
    verify(
      request({
        ...notification({ eventType: 'Send' }),
        MessageId: undefined,
        Signature: good.Signature,
      }),
    ),
    'payload',
  );
  await assert.rejects(verify({ body: { Type: 'Notification' } }), /raw body/);
});

test('Webhooks SES: a certificate that cannot be read or is not valid now is refused', async () => {
  const good = notification({ eventType: 'Send', mail: mail() });
  const failing = createSesWebhookVerifier({
    topicArns: [TOPIC],
    now: () => NOW,
    replayStore: null,
    fetch: async () => {
      throw new Error('offline');
    },
  });
  await rejects(failing.verify(request(good)), 'certificate');
  const missing = createSesWebhookVerifier({
    topicArns: [TOPIC],
    now: () => NOW,
    replayStore: null,
    fetch: async () => new Response('gone', { status: 404 }),
  });
  await rejects(missing.verify(request(good)), 'certificate');
  const garbage = createSesWebhookVerifier({
    topicArns: [TOPIC],
    now: () => NOW,
    replayStore: null,
    fetch: async () => new Response('not a certificate'),
  });
  await rejects(garbage.verify(request(good)), 'certificate');
  const late = verifier({ now: () => Date.parse('2200-01-01T00:00:00Z'), toleranceMs: 1e15 });
  await rejects(late.verify(request(good)), 'certificate');
});

test('Webhooks SES: the options are checked, and a replay store may be given or none', async () => {
  assert.throws(() => createSesWebhookVerifier({}), /topicArns must list/);
  assert.throws(() => createSesWebhookVerifier({ topicArns: [''] }), /topic ARN is a string/);
  assert.throws(() => createSesWebhookVerifier({ topicArns: [TOPIC] }), /replayStore is required/);
  assert.throws(
    () => createSesWebhookVerifier({ topicArns: [TOPIC], replayStore: null, fetch: 'x' }),
    /fetch/,
  );
  assert.throws(
    () => createSesWebhookVerifier({ topicArns: [TOPIC], toleranceMs: 0 }),
    /toleranceMs/,
  );
  assert.throws(
    () => createSesWebhookVerifier({ topicArns: [TOPIC], replayStore: {} }),
    /replayStore/,
  );
  const seen = [];
  const { verify } = verifier({
    replayStore: {
      reserve: async (id, leaseMs) => seen.push(['reserve', id, leaseMs]) && 'reserved',
      commit: async (id, ttlMs) => {
        seen.push(['commit', id, ttlMs]);
      },
      release: async (id) => {
        seen.push(['release', id]);
      },
    },
  });
  const good = notification({ eventType: 'Send', mail: mail() });
  await (await verify(request(good))).commit();
  assert.deepStrictEqual(seen, [
    ['reserve', storeKey('ses:sns-1'), 30 * 1000],
    ['commit', storeKey('ses:sns-1'), 2 * 60 * 60 * 1000],
  ]);
  const open = verifier({ replayStore: null });
  await open.verify(request(good));
  await open.verify(request(good));
  const big = verifier({ maxBodyBytes: 10 });
  await rejects(big.verify(request(good)), 'payload');
  const fetched = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return new Response(require('../helpers/webhooks/sns.js').certificate);
  };
  try {
    await createSesWebhookVerifier({
      topicArns: [TOPIC],
      now: () => NOW,
      replayStore: null,
    }).verify({
      body: Buffer.from(JSON.stringify(good)),
      headers: new Headers(),
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.deepStrictEqual(fetched, [CERT_URL]);
});

test('Webhooks SES: a certificate URL off the path of SNS, or with a query, is not read', async () => {
  // Before: any path and query of an SNS host was read before the signature,
  // so a message of a listed topic with `?x=N` made a new read each time and
  // pushed the real certificate out of the cache.
  const { verify, requests } = verifier();
  for (const url of [
    `${CERT_URL}?x=1`,
    `${CERT_URL}#x`,
    'https://sns.eu-west-1.amazonaws.com/other.pem',
    'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem/x',
  ]) {
    const message = notification({ eventType: 'Send', mail: mail() }, { SigningCertURL: url });
    await rejects(verify(request(message)), 'certificate');
  }
  assert.strictEqual(requests.length, 0);
});

test('Webhooks SES: a few certificates are read at a time, the next one is asked again', async () => {
  const waiting = [];
  const fetch = () =>
    new Promise((resolve) => {
      waiting.push(() => resolve(new Response(require('../helpers/webhooks/sns.js').certificate)));
    });
  const ses = createSesWebhookVerifier({
    topicArns: [TOPIC],
    fetch,
    now: () => NOW,
    replayStore: null,
  });
  const message = (index) =>
    notification(
      { eventType: 'Send', mail: mail() },
      {
        MessageId: `m-${index}`,
        SigningCertURL: `https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-c${index}.pem`,
      },
    );
  const reads = [];
  for (let index = 0; index < 4; index++) reads.push(ses.verify(request(message(index))));
  await assert.rejects(ses.verify(request(message(4))), (error) => {
    assert.strictEqual(error.reason, 'certificate');
    assert.strictEqual(error.status, 503);
    return true;
  });
  assert.strictEqual(waiting.length, 4);
  for (const release of waiting) release();
  for (const read of reads) assert.strictEqual((await read).events.length, 2);
  // Once read, the slots are free again.
  const later = ses.verify(request(message(5)));
  waiting[4]();
  assert.strictEqual((await later).events.length, 2);
});

test('Webhooks SES: the signature versions taken, and the time a certificate is read for', async () => {
  const sha1 = signSns(notification({ eventType: 'Send', mail: mail() }, { MessageId: 'v1' }), '1');
  const strict = verifier({ signatureVersions: ['2'], replayStore: null });
  await rejects(strict.verify(request(sha1)), 'signature');
  assert.strictEqual(
    (await verifier({ signatureVersions: ['1'], replayStore: null }).verify(request(sha1))).events
      .length,
    2,
  );
  assert.throws(() => verifier({ signatureVersions: [] }), /signatureVersions/);
  assert.throws(() => verifier({ signatureVersions: ['3'] }), /signatureVersions takes/);
  assert.throws(() => verifier({ certificateTimeoutMs: 0 }), /certificateTimeoutMs/);
  const slow = createSesWebhookVerifier({
    topicArns: [TOPIC],
    now: () => NOW,
    replayStore: null,
    certificateTimeoutMs: 5,
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
  });
  await assert.rejects(
    slow.verify(request(notification({ eventType: 'Send', mail: mail() }))),
    (error) => error.reason === 'certificate' && error.status === 503,
  );
});
