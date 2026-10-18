// Not ported: tests of what the webhook verifiers share.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  createMemoryReplayStore,
  dateOf,
  equalBytes,
  equalSecrets,
  headerOf,
} = require('../../src/webhooks/request.js');
const { storeKey } = require('../helpers/webhooks/store.js');

test('Webhooks: a header field is read from Headers or from Node headers, in any case', () => {
  const headers = new Headers({ 'Svix-Id': 'msg_1' });
  assert.strictEqual(headerOf({ headers }, 'svix-id'), 'msg_1');
  assert.strictEqual(headerOf({ headers }, 'svix-timestamp'), undefined);
  assert.strictEqual(headerOf({ headers: { 'svix-id': 'msg_2' } }, 'Svix-Id'), 'msg_2');
  assert.strictEqual(headerOf({ headers: { 'X-Twilio': ['a', 'b'] } }, 'x-twilio'), 'a');
  assert.strictEqual(headerOf({ headers: { other: 'x' } }, 'svix-id'), undefined);
  assert.strictEqual(headerOf({}, 'svix-id'), undefined);
  assert.strictEqual(headerOf(undefined, 'svix-id'), undefined);
});

test('Webhooks: secrets compare in constant time, a length apart is unequal', () => {
  assert.strictEqual(equalBytes(Buffer.from('abc'), Buffer.from('abc')), true);
  assert.strictEqual(equalBytes(Buffer.from('abc'), Buffer.from('abd')), false);
  assert.strictEqual(equalBytes(Buffer.from('abc'), Buffer.from('abcd')), false);
  assert.strictEqual(equalSecrets(Buffer.from('abc'), Buffer.from('abc')), true);
  assert.strictEqual(equalSecrets(Buffer.from('abc'), Buffer.from('abd')), false);
  assert.strictEqual(equalSecrets(Buffer.from('abc'), Buffer.from('abcd')), false);
});

test('Webhooks: credentials of another length take the time of the comparison', async (t) => {
  // Before: Basic and Bearer credentials were compared with equalBytes, which
  // answers at once for a length apart, so the time told the secret's length.
  const crypto = require('node:crypto');
  const compared = [];
  const original = crypto.timingSafeEqual;
  t.mock.method(crypto, 'timingSafeEqual', (a, b) => {
    compared.push([a.length, b.length]);
    return original(a, b);
  });
  const root = require('node:path').join(__dirname, '../../src/webhooks/');
  const fresh = () => {
    for (const name of Object.keys(require.cache)) {
      if (name.startsWith(root)) delete require.cache[name];
    }
  };
  fresh();
  t.after(fresh);
  const { createPostmarkWebhookVerifier: postmark } = require('../../src/webhooks/index.js');
  const verifier = postmark({ username: 'user', password: 'a long password of the hook' });
  const short = `Basic ${Buffer.from('user:x').toString('base64')}`;
  const body = JSON.stringify({ RecordType: 'Delivery', MessageID: 'm', Recipient: 'b@e.com' });
  await assert.rejects(verifier.verify({ body, headers: { authorization: short } }), /credentials/);
  assert.deepStrictEqual(compared, [[32, 32]]);
});

test('Webhooks: dates come from seconds, milliseconds or ISO text', () => {
  assert.strictEqual(dateOf(1_700_000_000).getTime(), 1_700_000_000_000);
  assert.strictEqual(dateOf(1_700_000_000_123).getTime(), 1_700_000_000_123);
  assert.strictEqual(dateOf('1700000000.5').getTime(), 1_700_000_000_500);
  assert.strictEqual(dateOf('2026-10-17T12:00:00Z').toISOString(), '2026-10-17T12:00:00.000Z');
  assert.strictEqual(dateOf('yesterday'), undefined);
  assert.strictEqual(dateOf(''), undefined);
  assert.strictEqual(dateOf(undefined), undefined);
  assert.strictEqual(dateOf(Number.NaN), undefined);
});

test('Webhooks: the memory replay store holds an id while it is handled, then keeps it', () => {
  let time = 0;
  const store = createMemoryReplayStore({ maxEntries: 2, now: () => time });
  assert.strictEqual(store.reserve('a', 10), 'reserved');
  assert.strictEqual(store.reserve('a', 10), 'pending');
  // A lease that runs out frees the id: the handler of the request died.
  time = 10;
  assert.strictEqual(store.reserve('a', 10), 'reserved');
  store.release('a');
  assert.strictEqual(store.reserve('a', 10), 'reserved');
  store.commit('a', 100);
  assert.strictEqual(store.reserve('a', 10), 'done');
  // A done id is not released, and is forgotten after its time.
  store.release('a');
  assert.strictEqual(store.reserve('a', 10), 'done');
  time = 110;
  assert.strictEqual(store.reserve('a', 10), 'reserved');
  store.commit('a', 1000);
  assert.throws(() => createMemoryReplayStore({ maxEntries: 0 }), /maxEntries/);
  assert.throws(() => createMemoryReplayStore({ now: 1 }), /now must be a function/);
  assert.strictEqual(createMemoryReplayStore().reserve('x', 1), 'reserved');
});

test('Webhooks: the memory replay store drops the oldest done ids, never a pending one', () => {
  let time = 0;
  const store = createMemoryReplayStore({ maxEntries: 2, now: () => time });
  assert.strictEqual(store.reserve('held', 1000), 'reserved');
  store.reserve('b', 1000);
  store.commit('b', 1000);
  store.reserve('c', 1000);
  store.commit('c', 1000);
  // Three ids for two places: b, the oldest done one, goes; held stays.
  assert.strictEqual(store.reserve('held', 1000), 'pending');
  assert.strictEqual(store.reserve('c', 1000), 'done');
  assert.strictEqual(store.reserve('b', 1000), 'reserved');
  time = 1000;
  // Expired ids go first.
  assert.strictEqual(store.reserve('held', 1000), 'reserved');
});

const { createHmac } = require('node:crypto');
const {
  WebhookVerificationError,
  createAzureWebhookVerifier,
  createBrevoWebhookVerifier,
  createLettermintWebhookVerifier,
  createMailerooWebhookVerifier,
  createMailerSendWebhookVerifier,
  createMailgunWebhookVerifier,
  createMailtrapWebhookVerifier,
  createPostmarkWebhookVerifier,
  createResendWebhookVerifier,
  createScalewayWebhookVerifier,
  createSendGridWebhookVerifier,
  createSesWebhookVerifier,
  createSmtp2goWebhookVerifier,
} = require('../../src/webhooks/index.js');
const { SECRET, signSvix } = require('../helpers/webhooks/svix.js');
const sns = require('../helpers/webhooks/sns.js');

const NOW = 1_800_000_000_000;
const refusal = (reason, status) => (error) => {
  assert.ok(error instanceof WebhookVerificationError, String(error));
  assert.strictEqual(error.reason, reason, error.message);
  assert.strictEqual(error.status, status);
  return true;
};
const resendEvent = JSON.stringify({
  type: 'email.delivered',
  data: { email_id: 'e-1', to: ['bob@example.com', 'carol@example.com'] },
});
const mailtrapBatch = (...ids) =>
  JSON.stringify({ events: ids.map((id) => ({ event: 'delivery', event_id: id })) });
const signMailtrap = (body) => ({
  body,
  headers: { 'mailtrap-signature': createHmac('sha256', 'mt').update(body).digest('hex') },
});

test('Webhooks: an event whose handler failed is taken again, once released', async () => {
  // Before: the id was kept as taken inside verify(), so a provider's
  // redelivery after a failed handler was a replay, answered 2xx, and lost.
  let time = NOW;
  const resend = createResendWebhookVerifier({
    secret: SECRET,
    now: () => time,
    replayStore: createMemoryReplayStore({ now: () => time }),
  });
  const request = signSvix(resendEvent, 'msg_fail');
  const failed = await resend.verify(request);
  await failed.release();
  const again = await resend.verify(request);
  assert.strictEqual(again.events.length, 2);
  // While it is handled, a redelivery waits: 503 asks the provider to retry.
  await assert.rejects(resend.verify(request), refusal('pending', 503));
  // A handler that died frees the id when its lease runs out.
  time += 30 * 1000;
  const retried = await resend.verify(request);
  await retried.commit();
  await assert.rejects(resend.verify(request), refusal('replay', 200));
});

test('Webhooks: a batch commits the events handled, the others are taken again', async () => {
  const mailtrap = createMailtrapWebhookVerifier({
    secret: 'mt',
    replayStore: createMemoryReplayStore(),
  });
  const request = signMailtrap(mailtrapBatch('ev-1', 'ev-2', 'ev-3'));
  const first = await mailtrap.verify(request);
  assert.strictEqual(first.events.length, 3);
  await first.commit([first.events[0], first.events[2]]);
  // An event committed already, or of another delivery, changes nothing.
  await first.commit([first.events[0], { id: 'foreign' }]);
  await first.release();
  const second = await mailtrap.verify(request);
  assert.deepStrictEqual(
    second.events.map((event) => event.id),
    ['ev-2'],
  );
  await second.commit();
  await assert.rejects(mailtrap.verify(request), refusal('replay', 200));
});

test('Webhooks: an id several events share is kept once all of them are committed', async () => {
  const served = sns.certificateFetch();
  const ses = createSesWebhookVerifier({
    topicArns: [sns.TOPIC],
    fetch: served.fetch,
    now: () => Date.parse('2027-01-01T12:00:30Z'),
    replayStore: createMemoryReplayStore(),
  });
  const message = sns.notification({
    eventType: 'Delivery',
    mail: { messageId: 'm-1', destination: ['bob@example.com', 'carol@example.com'] },
    delivery: { recipients: ['bob@example.com', 'carol@example.com'] },
  });
  const request = { body: JSON.stringify(message) };
  const first = await ses.verify(request);
  assert.strictEqual(first.events.length, 2);
  await first.commit([first.events[0]]);
  await first.release();
  const second = await ses.verify(request);
  assert.strictEqual(second.events.length, 2);
  await second.commit(second.events);
  await assert.rejects(ses.verify(request), refusal('replay', 200));
});

test('Webhooks: a store that fails releases the ids reserved before it', async () => {
  const calls = [];
  const store = {
    reserve: async (id) => {
      calls.push(['reserve', id]);
      if (id === storeKey('mailtrap:ev-2')) throw new Error('store down');
      return 'reserved';
    },
    commit: async (id) => {
      calls.push(['commit', id]);
    },
    release: async (id) => {
      calls.push(['release', id]);
    },
  };
  const mailtrap = createMailtrapWebhookVerifier({ secret: 'mt', replayStore: store });
  await assert.rejects(mailtrap.verify(signMailtrap(mailtrapBatch('ev-1', 'ev-2'))), /store down/);
  assert.deepStrictEqual(calls, [
    ['reserve', storeKey('mailtrap:ev-1')],
    ['reserve', storeKey('mailtrap:ev-2')],
    ['release', storeKey('mailtrap:ev-1')],
  ]);
  const odd = createMailtrapWebhookVerifier({
    secret: 'mt',
    replayStore: { ...store, reserve: () => true },
  });
  await assert.rejects(odd.verify(signMailtrap(mailtrapBatch('ev-9'))), /answered true/);
  const silent = createMailtrapWebhookVerifier({
    secret: 'mt',
    replayStore: { ...store, reserve: async () => {} },
  });
  await assert.rejects(silent.verify(signMailtrap(mailtrapBatch('ev-8'))), /answered undefined/);
});

test('Webhooks: the ids of a batch go to the store together, the events in their order', async () => {
  // Before: each id of a batch waited for the store's answer to the one
  // before it, a round trip per event of a batch of a thousand.
  let inFlight = 0;
  let most = 0;
  const answers = [];
  const call = () =>
    new Promise((resolve) => {
      inFlight++;
      most = Math.max(most, inFlight);
      answers.push(() => {
        inFlight--;
        resolve();
      });
    });
  const store = {
    reserve: async (id) => {
      await call();
      return 'reserved';
    },
    commit: call,
    release: call,
  };
  // The store answers the last id first.
  const answer = async () => {
    while (answers.length === 0) await new Promise((resolve) => setImmediate(resolve));
    while (answers.length > 0) answers.pop()();
  };
  const mailtrap = createMailtrapWebhookVerifier({ secret: 'mt', replayStore: store });
  const verified = mailtrap.verify(signMailtrap(mailtrapBatch('ev-1', 'ev-2', 'ev-3')));
  await answer();
  const delivery = await verified;
  assert.strictEqual(most, 3);
  assert.deepStrictEqual(
    delivery.events.map((event) => event.id),
    ['ev-1', 'ev-2', 'ev-3'],
  );
  most = 0;
  const committed = delivery.commit();
  await answer();
  await committed;
  assert.strictEqual(most, 3);
});

test('Webhooks: an id is kept in the store by its digest, never with an address', async () => {
  // Before: an event of Mailtrap without an event_id went into the store as
  // its message, type and recipient, so a shared store held the addresses.
  const keys = [];
  const mailtrap = createMailtrapWebhookVerifier({
    secret: 'mt',
    replayStore: {
      reserve: async (id) => keys.push(id) && 'reserved',
      commit: async () => {},
      release: async () => {},
    },
  });
  const body = JSON.stringify({
    events: [{ event: 'delivery', message_id: 'm-1', email: 'bob@example.com' }],
  });
  const { events } = await mailtrap.verify(signMailtrap(body));
  assert.strictEqual(events[0].id, 'm-1:delivery:bob@example.com');
  assert.deepStrictEqual(keys, [storeKey('mailtrap:m-1:delivery:bob@example.com')]);
  assert.match(keys[0], /^mailtrap:[\w-]{43}$/);
});

test('Webhooks: a batch with nothing new waits for its other delivery, or is a replay', async () => {
  const mailtrap = createMailtrapWebhookVerifier({
    secret: 'mt',
    replayStore: createMemoryReplayStore(),
  });
  const request = signMailtrap(mailtrapBatch('ev-1', 'ev-2'));
  const first = await mailtrap.verify(request);
  await assert.rejects(mailtrap.verify(request), refusal('pending', 503));
  await first.commit();
  await assert.rejects(mailtrap.verify(request), refusal('replay', 200));
  // A body with no record is no replay: nothing was reserved, nothing refused.
  assert.deepStrictEqual((await mailtrap.verify(signMailtrap('{"events":[]}'))).events, []);
});

test('Webhooks: every verifier that keeps ids needs a replay store, null to keep none', () => {
  // Before: an in-process store was made silently for each verifier, which a
  // function that makes its verifier per request, or several processes, do
  // not share.
  const { publicKey } = require('node:crypto').generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const makers = [
    () => createResendWebhookVerifier({ secret: SECRET }),
    () =>
      createSendGridWebhookVerifier({
        publicKey: publicKey.export({ format: 'pem', type: 'spki' }),
      }),
    () => createMailgunWebhookVerifier({ signingKey: 'k' }),
    () => createMailerSendWebhookVerifier({ secret: 's' }),
    () => createMailtrapWebhookVerifier({ secret: 's' }),
    () => createMailerooWebhookVerifier({ secret: 's' }),
    () => createLettermintWebhookVerifier({ secret: 's' }),
    () => createAzureWebhookVerifier({ token: 't' }),
    () => createSesWebhookVerifier({ topicArns: [sns.TOPIC] }),
    () =>
      createScalewayWebhookVerifier({
        topicArns: [sns.TOPIC],
        trustChain: sns.scaleway.trustChain,
      }),
  ];
  for (const make of makers) assert.throws(make, /replayStore is required/);
  assert.throws(
    () => createMailtrapWebhookVerifier({ secret: 's', replayStore: { reserve() {} } }),
    /replayStore must have a commit method/,
  );
  assert.throws(
    () => createMailtrapWebhookVerifier({ secret: 's', replayStore: null, leaseMs: 0 }),
    /leaseMs/,
  );
  // The providers that sign no id keep nothing, and need no store.
  assert.ok(createPostmarkWebhookVerifier({ username: 'u', password: 'p' }));
  assert.ok(createBrevoWebhookVerifier({ token: 't' }));
  assert.ok(createSmtp2goWebhookVerifier({ username: 'u', password: 'p' }));
});

test('Webhooks: a verifier of a provider that signs no time refuses a window of time', () => {
  // Before: toleranceMs and now were taken and never read, so a caller who
  // set a window believed old requests were refused.
  const makers = [
    (more) => createPostmarkWebhookVerifier({ username: 'u', password: 'p', ...more }),
    (more) => createBrevoWebhookVerifier({ token: 't', ...more }),
    (more) => createSmtp2goWebhookVerifier({ username: 'u', password: 'p', ...more }),
    (more) => createMailerSendWebhookVerifier({ secret: 's', replayStore: null, ...more }),
    (more) => createMailtrapWebhookVerifier({ secret: 's', replayStore: null, ...more }),
    (more) => createMailerooWebhookVerifier({ secret: 's', replayStore: null, ...more }),
    (more) => createAzureWebhookVerifier({ token: 't', replayStore: null, ...more }),
  ];
  for (const make of makers) {
    assert.ok(make({}));
    assert.throws(() => make({ toleranceMs: 60_000 }), /toleranceMs is not read/);
    assert.throws(() => make({ now: Date.now }), /now is not read/);
  }
});

test('Webhooks: a verifier of a provider that signs no id refuses a replay store', () => {
  // Before: Postmark, Brevo, Mailjet, SparkPost and SMTP2GO took a replayStore
  // and a leaseMs and never read them, so a caller believed requests were
  // taken once.
  const {
    createMailjetWebhookVerifier,
    createSparkPostWebhookVerifier,
  } = require('../../src/webhooks/index.js');
  const makers = [
    (more) => createPostmarkWebhookVerifier({ username: 'u', password: 'p', ...more }),
    (more) => createBrevoWebhookVerifier({ token: 't', ...more }),
    (more) => createSmtp2goWebhookVerifier({ username: 'u', password: 'p', ...more }),
    (more) => createMailjetWebhookVerifier({ username: 'u', password: 'p', ...more }),
    (more) => createSparkPostWebhookVerifier({ username: 'u', password: 'p', ...more }),
  ];
  for (const make of makers) {
    assert.throws(
      () => make({ replayStore: createMemoryReplayStore() }),
      /replayStore is not read/,
    );
    assert.throws(() => make({ leaseMs: 1000 }), /leaseMs is not read/);
    assert.throws(() => make({ toleranceMs: 1000 }), /toleranceMs is not read/);
  }
});

test('Webhooks: the validation URL of Azure carries no credentials', async () => {
  // Before: a password without a user name passed the check of the URL.
  const azure = createAzureWebhookVerifier({ token: 't', replayStore: null });
  const body = JSON.stringify([
    {
      id: 'v-1',
      eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
      data: { validationCode: 'c', validationUrl: 'https://:pw@rp-eu.eventgrid.azure.net/x' },
    },
  ]);
  await assert.rejects(
    azure.verify({ body, headers: { 'aeg-event-type': 'SubscriptionValidation' } }),
    refusal('payload', 400),
  );
});

test('Webhooks: a refusal says what to answer, a certificate not read asks for a retry', async () => {
  assert.strictEqual(new WebhookVerificationError('signature', 'x').status, 401);
  assert.strictEqual(new WebhookVerificationError('payload', 'x').status, 400);
  assert.strictEqual(new WebhookVerificationError('topic', 'x', { status: 403 }).status, 403);
  const offline = createSesWebhookVerifier({
    topicArns: [sns.TOPIC],
    now: () => Date.parse('2027-01-01T12:00:30Z'),
    replayStore: null,
    fetch: async () => {
      throw new Error('offline');
    },
  });
  const message = sns.notification({ eventType: 'Send', mail: { messageId: 'm' } });
  await assert.rejects(
    offline.verify({ body: JSON.stringify(message) }),
    refusal('certificate', 503),
  );
  // A delivery of a provider that keeps nothing commits nothing.
  const postmark = createPostmarkWebhookVerifier({ username: 'u', password: 'p' });
  const delivery = await postmark.verify({
    body: JSON.stringify({ RecordType: 'Delivery', MessageID: 'm', Recipient: 'bob@example.com' }),
    headers: { authorization: `Basic ${Buffer.from('u:p').toString('base64')}` },
  });
  await delivery.commit();
  await delivery.release();
  assert.strictEqual(delivery.events.length, 1);
});

test('Webhooks: an event carries the Message-ID it was sent with, and its recipient by domain', async () => {
  // Before: an event had only the provider's id of the message, which a
  // receipt of unknown delivery lacks, and the recipient as each provider
  // wrote it.
  const { createEvent, headerValueOf } = require('../../src/webhooks/request.js');
  const event = createEvent({
    provider: 'x',
    type: 'delivered',
    id: '1',
    rfcMessageId: '<m-1@example.com>',
    recipient: 'Bob.Smith@Example.COM',
  });
  assert.strictEqual(event.rfcMessageId, '<m-1@example.com>');
  assert.strictEqual(event.recipient, 'Bob.Smith@example.com');
  assert.strictEqual(headerValueOf([{ key: 'Message-ID', value: '<a@b>' }], 'message-id'), '<a@b>');
  assert.strictEqual(
    headerValueOf([{ name: 'message-id', value: '<c@d>' }], 'Message-ID'),
    '<c@d>',
  );
  assert.strictEqual(headerValueOf({ 'Message-Id': '<e@f>' }, 'message-id'), '<e@f>');
  assert.strictEqual(headerValueOf([{ key: 'Subject', value: 's' }], 'message-id'), undefined);
  assert.strictEqual(headerValueOf('text', 'message-id'), undefined);
  const served = sns.certificateFetch();
  const ses = createSesWebhookVerifier({
    topicArns: [sns.TOPIC],
    fetch: served.fetch,
    now: () => Date.parse('2027-01-01T12:00:30Z'),
    replayStore: null,
  });
  const message = sns.notification({
    eventType: 'Delivery',
    mail: {
      messageId: 'ses-1',
      destination: ['Carol@Example.org'],
      commonHeaders: { messageId: '<sent-1@example.com>' },
    },
    delivery: { recipients: ['Carol@Example.org'] },
  });
  const { events } = await ses.verify({ body: JSON.stringify(message) });
  assert.strictEqual(events[0].rfcMessageId, '<sent-1@example.com>');
  assert.strictEqual(events[0].recipient, 'Carol@example.org');
});

test('Webhooks: onVerify hears each request taken or refused, and why', async (t) => {
  // Before: a verifier said nothing of what it refused, so a forged flood or
  // a wrong secret did not show.
  const reports = [];
  const mailtrap = createMailtrapWebhookVerifier({
    secret: 'mt',
    replayStore: createMemoryReplayStore(),
    onVerify: (report) => reports.push(report),
  });
  const request = signMailtrap(mailtrapBatch('ev-1', 'ev-2'));
  await (await mailtrap.verify(request)).commit();
  await assert.rejects(mailtrap.verify(request));
  await assert.rejects(mailtrap.verify({ body: '{}', headers: {} }));
  await assert.rejects(mailtrap.verify({ body: {} }), TypeError);
  assert.deepStrictEqual(
    reports.map((report) => [report.provider, report.status, report.reason, report.events]),
    [
      ['mailtrap', 'taken', undefined, 2],
      ['mailtrap', 'refused', 'replay', 0],
      ['mailtrap', 'refused', 'signature', 0],
      ['mailtrap', 'error', undefined, 0],
    ],
  );
  for (const report of reports) assert.ok(report.durationMs >= 0);
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text, options) => warnings.push(options.code));
  const postmark = createPostmarkWebhookVerifier({
    username: 'u',
    password: 'p',
    onVerify: () => {
      throw new Error('metrics down');
    },
  });
  await assert.rejects(postmark.verify({ body: '{}' }), WebhookVerificationError);
  assert.deepStrictEqual(warnings, ['MAILER_WEBHOOK_LISTENER_FAILED']);
  assert.throws(
    () => createMailtrapWebhookVerifier({ secret: 's', replayStore: null, onVerify: 1 }),
    /onVerify must be a function/,
  );
});

test('Webhooks: a late commit or release under another token leaves the id alone', async () => {
  // Before: commit and release took the id alone, so a request whose lease
  // ran out freed the reservation of the delivery that held the id now, and
  // a third one was handled at the same time.
  let time = 0;
  const store = createMemoryReplayStore({ now: () => time });
  assert.strictEqual(store.reserve('a', 1000, 'first'), 'reserved');
  time = 1500;
  assert.strictEqual(store.reserve('a', 1000, 'second'), 'reserved');
  store.release('a', 'first');
  assert.strictEqual(store.reserve('a', 1000, 'third'), 'pending');
  store.commit('a', 5000, 'first');
  assert.strictEqual(store.reserve('a', 1000, 'third'), 'pending');
  store.commit('a', 5000, 'second');
  assert.strictEqual(store.reserve('a', 1000, 'third'), 'done');
  // A commit after the lease, with nobody holding the id, still keeps it.
  assert.strictEqual(store.reserve('b', 1000, 'x'), 'reserved');
  time = 3000;
  store.commit('b', 5000, 'x');
  assert.strictEqual(store.reserve('b', 1000, 'y'), 'done');
  // The verifier passes one token per delivery to each call.
  const calls = [];
  const watching = {
    reserve: async (id, leaseMs, token) => calls.push(['reserve', token]) && 'reserved',
    commit: async (id, ttlMs, token) => {
      calls.push(['commit', token]);
    },
    release: async (id, token) => {
      calls.push(['release', token]);
    },
  };
  const mailtrap = createMailtrapWebhookVerifier({ secret: 'mt', replayStore: watching });
  const delivery = await mailtrap.verify(signMailtrap(mailtrapBatch('ev-1', 'ev-2')));
  await delivery.commit([delivery.events[0]]);
  await delivery.release();
  const tokens = new Set(calls.map((call) => call[1]));
  assert.strictEqual(tokens.size, 1);
  assert.match([...tokens][0], /^[0-9a-f-]{36}$/);
  assert.deepStrictEqual(
    calls.map((call) => call[0]),
    ['reserve', 'reserve', 'commit', 'release'],
  );
});

test('Webhooks: the memory replay store tells of a committed id dropped before its time', (t) => {
  // Before: past maxEntries, live committed ids were dropped silently, so a
  // request sent again in their time was taken twice.
  const warned = [];
  t.mock.method(process, 'emitWarning', (_text, options) => warned.push(options?.code));
  const store = createMemoryReplayStore({ maxEntries: 2, now: () => 0 });
  for (const id of ['a', 'b', 'c']) {
    store.reserve(id, 1000, id);
    store.commit(id, 60_000, id);
  }
  assert.deepStrictEqual(warned, ['MAILER_REPLAY_EVICTED']);
  assert.strictEqual(store.reserve('a', 1000, 'again'), 'reserved');
});
