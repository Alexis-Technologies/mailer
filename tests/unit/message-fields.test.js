// Not ported: `scheduledAt`, `tracking` and `metadata` of a message (from
// unemail), checked by createMessage, and the refusal of a scheduled message by
// every transport that cannot schedule it, before anything is sent.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { SmtpTransport } = require('../../src/smtp/index.js');
const { SesTransport } = require('../../src/ses/index.js');
const { SendGridTransport } = require('../../src/sendgrid/index.js');
const { MailgunTransport } = require('../../src/mailgun/index.js');
const { ResendTransport } = require('../../src/resend/index.js');
const { MailtrapTransport } = require('../../src/mailtrap/index.js');
const { MailerooTransport } = require('../../src/maileroo/index.js');
const { LettermintTransport } = require('../../src/lettermint/index.js');
const { PlunkTransport } = require('../../src/plunk/index.js');
const { JmapTransport } = require('../../src/jmap/index.js');
const { PoolTransport } = require('../../src/pool/index.js');
const { RetryTransport } = require('../../src/retry/index.js');
const { MockTransport } = require('../../src/mock/index.js');
const { MockSmtpServer } = require('../helpers/smtp/mock-smtp-server.js');

const base = {
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
};
const tomorrow = new Date('2026-10-18T09:00:00Z');
const scheduled = () => createMessage({ ...base, scheduledAt: tomorrow });

test('Fields: createMessage keeps scheduledAt, tracking and metadata, checked', () => {
  const message = createMessage({
    ...base,
    scheduledAt: tomorrow,
    tracking: { opens: false, clicks: true },
    metadata: { orderId: '42', 'tenant.id': 'acme', step_2: '' },
  });
  assert.deepStrictEqual(message.scheduledAt, tomorrow);
  assert.notStrictEqual(message.scheduledAt, tomorrow);
  assert.deepStrictEqual(message.tracking, { opens: false, clicks: true });
  assert.ok(Object.isFrozen(message.tracking));
  assert.deepStrictEqual(
    { ...message.metadata },
    { orderId: '42', 'tenant.id': 'acme', step_2: '' },
  );
  assert.strictEqual(Object.getPrototypeOf(message.metadata), null);
  assert.ok(Object.isFrozen(message.metadata));
  const plain = createMessage(base);
  assert.strictEqual(plain.scheduledAt, undefined);
  assert.strictEqual(plain.tracking, undefined);
  assert.strictEqual(plain.metadata, undefined);
  assert.deepStrictEqual(createMessage({ ...base, tracking: { opens: undefined } }).tracking, {});
});

test('Fields: an invalid scheduledAt, tracking or metadata is refused', () => {
  const refused = [
    [{ scheduledAt: new Date('nope') }, /Invalid scheduledAt/],
    [{ scheduledAt: '2026-10-18T09:00:00Z' }, /Invalid scheduledAt/],
    [{ tracking: true }, /Invalid tracking: it must be an object/],
    [{ tracking: ['opens'] }, /Invalid tracking: it must be an object/],
    [{ tracking: { opened: true } }, /Invalid tracking field: opened/],
    [{ tracking: { opens: 'yes' } }, /Invalid tracking.opens/],
    [{ metadata: 'a=b' }, /Invalid metadata: it must be an object/],
    [{ metadata: { 'bad key': 'x' } }, /Invalid metadata key/],
    [{ metadata: { 'Bcc:\r\nx': 'x' } }, /Invalid metadata key/],
    [{ metadata: { ключ: 'x' } }, /Invalid metadata key/],
    [{ metadata: { ['k'.repeat(129)]: 'x' } }, /Invalid metadata key/],
    [{ metadata: { key: 'line\r\nbreak' } }, /Invalid metadata value of key/],
    [{ metadata: { key: 42 } }, /Invalid metadata value of key/],
  ];
  for (const [fields, error] of refused) {
    assert.throws(() => createMessage({ ...base, ...fields }), error, JSON.stringify(fields));
  }
});

const assertRefused = (receipt) => {
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.retryable, false);
  assert.strictEqual(receipt.errors[0].category, 'validation');
  assert.match(receipt.errorMessages[0], /Invalid scheduledAt: \w+ cannot schedule a message/);
};

test('Fields: SMTP refuses a scheduled message before it connects', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  try {
    const transport = new SmtpTransport({ host: 'localhost', port, pool: false });
    assertRefused(await transport.send(scheduled()));
    const receipts = [];
    for await (const receipt of transport.sendMany([scheduled(), createMessage(base)])) {
      receipts.push(receipt);
    }
    assertRefused(receipts[0]);
    assert.strictEqual(receipts[1].successful, true);
    assert.strictEqual(server.getReceivedMessages().length, 1);
  } finally {
    await server.stop();
  }
});

const providers = {
  ses: () =>
    new SesTransport({
      authentication: { type: 'credentials', accessKeyId: 'AKID', secretAccessKey: 'secret' },
      retries: 0,
    }),
  sendgrid: () => new SendGridTransport({ apiKey: 'SG.key', retries: 0 }),
  mailgun: () => new MailgunTransport({ apiKey: 'key', domain: 'mg.example.com', retries: 0 }),
  resend: () => new ResendTransport({ apiKey: 'key', retries: 0 }),
  mailtrap: () => new MailtrapTransport({ apiToken: 'token', retries: 0 }),
  maileroo: () => new MailerooTransport({ apiKey: 'key', retries: 0 }),
  lettermint: () => new LettermintTransport({ apiToken: 'token', retries: 0 }),
  plunk: () => new PlunkTransport({ apiKey: 'key', retries: 0 }),
};

for (const [name, make] of Object.entries(providers)) {
  test(`Fields: ${name} refuses a scheduled message without a request`, async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('no request expected');
    });
    const transport = make();
    assertRefused(await transport.send(scheduled()));
    const receipts = [];
    for await (const receipt of transport.sendMany([scheduled(), scheduled()])) {
      receipts.push(receipt);
    }
    assert.strictEqual(receipts.length, 2);
    for (const receipt of receipts) assertRefused(receipt);
    assert.strictEqual(fetch.mock.callCount(), 0);
  });
}

test('Fields: Resend sends the others of a chunk in one batch request', async (t) => {
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    bodies.push({ url: String(input), body: JSON.parse(init.body) });
    if (String(input).endsWith('/emails/batch')) {
      return Response.json({ data: [{ id: 'r1' }, { id: 'r2' }] });
    }
    return Response.json({ id: 'single' });
  });
  const transport = providers.resend();
  const receipts = [];
  for await (const receipt of transport.sendMany([
    createMessage(base),
    scheduled(),
    createMessage(base),
  ])) {
    receipts.push(receipt);
  }
  // A scheduled message keeps the chunk off the batch API, so each goes alone.
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful),
    [true, false, true],
  );
  assertRefused(receipts[1]);
  assert.strictEqual(bodies.length, 2);
});

const CORE = 'urn:ietf:params:jmap:core';
const MAIL = 'urn:ietf:params:jmap:mail';
const SUBMISSION = 'urn:ietf:params:jmap:submission';

test('Fields: JMAP refuses a scheduled message, and keeps the order of a batch', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jmap')) {
      return Response.json({
        capabilities: { [CORE]: {}, [MAIL]: {}, [SUBMISSION]: {} },
        accounts: {
          a1: {
            name: 'A',
            isPersonal: true,
            isReadOnly: false,
            accountCapabilities: { [MAIL]: {}, [SUBMISSION]: {} },
          },
        },
        primaryAccounts: { [MAIL]: 'a1' },
        username: 'alex@example.com',
        apiUrl: 'https://jmap.example.com/api',
        downloadUrl: 'https://jmap.example.com/download/{accountId}/{blobId}/{name}',
        uploadUrl: 'https://jmap.example.com/upload/{accountId}/',
        eventSourceUrl: 'https://jmap.example.com/events',
        state: '1',
      });
    }
    const methodResponses = [];
    for (const [name, args, id] of JSON.parse(init.body).methodCalls) {
      calls.push(name);
      const created = {};
      for (const key in args.create ?? {}) created[key] = { id: key, blobId: 'b', threadId: 't' };
      const results = {
        'Mailbox/get': { list: [{ id: 'drafts', role: 'drafts', name: 'Drafts' }] },
        'Identity/get': { list: [{ id: 'i1', email: 'alex@example.com', name: 'Alex' }] },
        'Email/set': { created },
        'EmailSubmission/set': { created },
      };
      methodResponses.push([name, results[name], id]);
    }
    return Response.json({ methodResponses });
  });
  const transport = new JmapTransport({
    sessionUrl: 'https://jmap.example.com/.well-known/jmap',
    bearerToken: 'token',
    retries: 0,
  });
  assertRefused(await transport.send(scheduled()));
  assert.deepStrictEqual(calls, []);
  const receipts = [];
  const input = [createMessage(base), scheduled(), createMessage(base), createMessage(base)];
  for await (const receipt of transport.sendMany(input)) receipts.push(receipt);
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful),
    [true, false, true, true],
  );
  assertRefused(receipts[1]);
  // The runs on either side of the refused message go as two Email/set calls.
  assert.strictEqual(calls.filter((call) => call === 'Email/set').length, 2);
  const allRefused = [];
  for await (const receipt of transport.sendMany([scheduled(), scheduled()])) {
    allRefused.push(receipt);
  }
  assert.strictEqual(allRefused.length, 2);
  for (const receipt of allRefused) assertRefused(receipt);
});

test('Fields: the pool does not fail over with a refusal, and retry does not retry it', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('no request expected');
  });
  const mock = new MockTransport();
  const pool = new PoolTransport({
    strategy: 'priority',
    transports: [
      { transport: providers.ses(), priority: 2 },
      { transport: mock, priority: 1 },
    ],
  });
  assertRefused(await pool.send(scheduled()));
  assert.strictEqual(mock.getSentMessagesCount(), 0);
  let attempts = 0;
  const counted = {
    send: async (message, options) => {
      attempts++;
      return providers.ses().send(message, options);
    },
    async *sendMany() {},
  };
  const retry = new RetryTransport(counted, { maxAttempts: 3, initialDelay: 1 });
  assertRefused(await retry.send(scheduled()));
  assert.strictEqual(attempts, 1);
});

test('Fields: the mock transport records a scheduled message as it is', async () => {
  const mock = new MockTransport();
  const receipt = await mock.send(scheduled());
  assert.strictEqual(receipt.successful, true);
  assert.deepStrictEqual(mock.getSentMessages()[0].scheduledAt, tomorrow);
});
