// Paths of the ported JMAP transport (src/jmap/) that upstream reaches only
// through its e2e suite against Stalwart: account, mailbox and identity
// discovery failures, rejected creations and submissions, against a fake
// JMAP server on a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { JmapTransport } = require('../../src/jmap/index.js');
const { uploadBlob } = require('../../src/jmap/blob-uploader.js');
const { createJmapConfig } = require('../../src/jmap/config.js');

const CORE = 'urn:ietf:params:jmap:core';
const MAIL = 'urn:ietf:params:jmap:mail';
const SUBMISSION = 'urn:ietf:params:jmap:submission';

const message = () =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });
const session = (overrides = {}) => ({
  capabilities: { [CORE]: {}, [MAIL]: {}, [SUBMISSION]: {} },
  accounts: {
    a1: {
      name: 'Alex',
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
  ...overrides,
});
const defaults = {
  'Mailbox/get': () => ({ list: [{ id: 'drafts', role: 'drafts', name: 'Drafts' }] }),
  'Identity/get': () => ({ list: [{ id: 'i1', email: 'alex@example.com', name: 'Alex' }] }),
  'Email/set': () => ({ created: { draft: { id: 'e1', blobId: 'b1', threadId: 't1' } } }),
  'EmailSubmission/set': () => ({ created: { submission: { id: 's1' } } }),
};

// A fake JMAP server: the session document, then one response per method
// call; a handler that returns null leaves its method out of the reply.
const serve = (t, handlers = {}) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/.well-known/jmap')) return Response.json(handlers.session ?? session());
    const { methodCalls } = JSON.parse(init.body);
    const methodResponses = [];
    for (const [name, args, id] of methodCalls) {
      calls.push(name);
      const result = (handlers[name] ?? defaults[name])(args);
      if (result !== null) methodResponses.push([name, result, id]);
    }
    return Response.json({ methodResponses });
  });
  return calls;
};
const transport = (config = {}) =>
  new JmapTransport({
    sessionUrl: 'https://jmap.example.com/.well-known/jmap',
    bearerToken: 'token',
    retries: 0,
    ...config,
  });
const errorOf = async (receiptPromise) => {
  const receipt = await receiptPromise;
  assert.strictEqual(receipt.successful, false);
  return receipt.errorMessages.join(' | ');
};

test('JMAP: a message goes out, through the base URL when one is set', async (t) => {
  const calls = serve(t);
  const receipt = await transport({ baseUrl: 'http://localhost:8080' }).send(message());
  assert.strictEqual(receipt.successful, true);
  assert.ok(calls.includes('http://localhost:8080/api'), calls.join(', '));
});

test('JMAP: a session without a mail account fails every message', async (t) => {
  const accounts = {
    a1: { name: 'A', isPersonal: true, isReadOnly: false, accountCapabilities: {} },
  };
  serve(t, { session: session({ accounts, primaryAccounts: {} }) });
  assert.match(await errorOf(transport().send(message())), /No mail-capable account found/);
  const receipts = [];
  for await (const receipt of transport().sendMany([message(), message()])) receipts.push(receipt);
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.errors[0].code),
    ['jmap.no_mail_account', 'jmap.no_mail_account'],
  );
});

test('JMAP: mailbox discovery fails without a reply, mailboxes or drafts', async (t) => {
  const cases = [
    [() => null, /No Mailbox\/get response received/],
    [() => ({}), /No mailboxes found/],
    [() => ({ list: [{ id: 'inbox', role: 'inbox', name: 'Inbox' }] }), /No drafts mailbox found/],
  ];
  for (const [mailboxes, expected] of cases) {
    t.mock.restoreAll();
    serve(t, { 'Mailbox/get': mailboxes });
    assert.match(await errorOf(transport().send(message())), expected);
  }
});

test('JMAP: identity discovery fails without a reply or identities; a set id skips it', async (t) => {
  for (const [identities, expected] of [
    [() => null, /No Identity\/get response received/],
    [() => ({ list: [] }), /No identities found/],
  ]) {
    t.mock.restoreAll();
    serve(t, { 'Identity/get': identities });
    assert.match(await errorOf(transport().send(message())), expected);
  }
  t.mock.restoreAll();
  const calls = serve(t);
  assert.strictEqual((await transport({ identityId: 'i9' }).send(message())).successful, true);
  assert.ok(!calls.includes('Identity/get'));
});

test('JMAP: rejected creations and submissions fail the send', async (t) => {
  const cases = [
    [
      {
        'EmailSubmission/set': () => ({}),
        'Email/set': () => ({
          notCreated: { draft: { type: 'invalidProperties', description: 'bad' } },
        }),
      },
      /Email creation failed \(draft\): invalidProperties - bad/,
    ],
    [
      { 'EmailSubmission/set': () => ({ notCreated: { submission: { type: 'forbiddenFrom' } } }) },
      /Email submission failed \(submission\): forbiddenFrom/,
    ],
    [
      { 'Email/set': () => ({}), 'EmailSubmission/set': () => ({}) },
      /Unknown error: No submission result received/,
    ],
  ];
  for (const [handlers, expected] of cases) {
    t.mock.restoreAll();
    serve(t, handlers);
    assert.match(await errorOf(transport().send(message())), expected);
  }
});

test('JMAP: an abort that is not the caller fails the send as retryable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('The operation was aborted.', 'AbortError');
  });
  const receipt = await transport().send(message());
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.retryable, true);
});

test('JMAP: verification refuses a session without the submission capability', async (t) => {
  serve(t, { session: session({ capabilities: { [CORE]: {}, [MAIL]: {} } }) });
  await assert.rejects(transport().verify(), /lacks core, mail, or submission capability/);
});

test('JMAP: a submission is sent once; it stays retryable only if it never left', async (t) => {
  for (const [code, isUnknown] of [
    ['ECONNREFUSED', false],
    ['ECONNRESET', true],
  ]) {
    const calls = serve(t, {
      'Email/set': () => {
        const cause = Object.assign(new Error(code), { code });
        throw new TypeError('fetch failed', { cause });
      },
    });
    const receipt = await transport({ retries: 3 }).send(message());
    assert.strictEqual(receipt.successful, false);
    assert.strictEqual(calls.filter((call) => call === 'Email/set').length, 1);
    assert.strictEqual(receipt.deliveryUnknown, isUnknown ? true : undefined, code);
    assert.strictEqual(receipt.retryable, !isUnknown, code);
    t.mock.restoreAll();
  }
});

test('JMAP: no request follows a redirect', async (t) => {
  const redirects = new Set();
  const calls = serve(t);
  const original = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, init) => {
    redirects.add(init.redirect);
    return original(input, init);
  });
  const receipt = await transport().send(message());
  assert.ok(calls.length > 0);
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join(' | '));
  assert.deepStrictEqual([...redirects], ['manual']);
});

test('JMAP: a blob upload does not follow a redirect', async (t) => {
  const redirects = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    redirects.push(init.redirect);
    return Response.json({ blobId: 'b1' });
  });
  const config = createJmapConfig({ sessionUrl: 'https://jmap.example.com/s', bearerToken: 't' });
  await uploadBlob(config, 'https://jmap.example.com/upload/{accountId}', 'a1', new Blob(['a']));
  assert.deepStrictEqual(redirects, ['manual']);
});

test('JMAP: Basic authentication encodes credentials outside Latin-1 as UTF-8', async (t) => {
  const authorizations = new Set();
  serve(t);
  const original = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, init) => {
    authorizations.add(new Headers(init.headers).get('Authorization'));
    return original(input, init);
  });
  const receipt = await transport({
    bearerToken: undefined,
    basicAuth: { username: 'алекс', password: 'пароль-✓' },
  }).send(message());
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join(' | '));
  const expected = `Basic ${Buffer.from('алекс:пароль-✓').toString('base64')}`;
  assert.deepStrictEqual([...authorizations], [expected]);
});
