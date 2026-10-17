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

test('JMAP: attachments that share a content ID keep their own blobs', async (t) => {
  let created;
  serve(t, {
    'Email/set': (args) => {
      created = args.create.draft;
      return defaults['Email/set']();
    },
  });
  const original = globalThis.fetch;
  let uploads = 0;
  t.mock.method(globalThis, 'fetch', (input, init) =>
    String(input).includes('/upload/')
      ? Promise.resolve(Response.json({ blobId: `blob-${++uploads}` }))
      : original(input, init),
  );
  const attachment = (filename) => ({
    inline: false,
    filename,
    content: new TextEncoder().encode(filename),
    contentType: 'text/plain',
    contentId: '',
  });
  const receipt = await transport().send(
    createMessage({
      from: 'alex@example.com',
      to: 'bob@example.com',
      subject: 'Two files',
      content: { text: 'Hi' },
      attachments: [attachment('a.txt'), attachment('b.txt')],
    }),
  );
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join(' | '));
  const parts = created.bodyStructure.subParts.filter((part) => part.blobId != null);
  assert.deepStrictEqual(
    parts.map((part) => [part.name, part.blobId]),
    [
      ['a.txt', 'blob-1'],
      ['b.txt', 'blob-2'],
    ],
  );
});

test('JMAP: a Session naming another origin is refused, unless that origin is trusted', async (t) => {
  const evil = 'https://evil.example';
  const calls = serve(t, { session: session({ apiUrl: `${evil}/api` }) });
  const refused = await transport().send(message());
  assert.strictEqual(refused.successful, false);
  assert.match(refused.errorMessages[0], /evil\.example, which is not trusted/);
  assert.ok(
    calls.every((call) => !call.startsWith(evil)),
    calls.join(' '),
  );

  const trusted = await transport({ trustedOrigins: [evil] }).send(message());
  assert.strictEqual(trusted.successful, true, trusted.errorMessages?.join(' | '));
  assert.ok(calls.some((call) => call.startsWith(evil)));
});

test('JMAP: a 401 makes the next send fetch the Session again', async (t) => {
  let sessionFetches = 0;
  let rejected = false;
  serve(t);
  const served = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, init) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jmap')) sessionFetches++;
    if (url.endsWith('/api') && !rejected) {
      rejected = true;
      return Promise.resolve(new Response('', { status: 401 }));
    }
    return served(input, init);
  });
  const jmap = transport();
  assert.strictEqual((await jmap.send(message())).successful, false);
  assert.strictEqual((await jmap.send(message())).successful, true);
  assert.strictEqual(sessionFetches, 2);
});

test('JMAP: sendMany splits its batch by the maxObjectsInSet of the Session', async (t) => {
  // Each /set answers its creations, except in the second batch, refused whole.
  const answer = (prefix) => {
    let sets = 0;
    return (args) => {
      sets++;
      const keys = Object.keys(args.create);
      const entries = keys.map((key) => [
        key,
        sets === 2 ? { type: 'tooLarge' } : { id: prefix + key },
      ]);
      return sets === 2
        ? { notCreated: Object.fromEntries(entries) }
        : { created: Object.fromEntries(entries) };
    };
  };
  const calls = serve(t, {
    session: session({
      capabilities: { [CORE]: { maxObjectsInSet: 2 }, [MAIL]: {}, [SUBMISSION]: {} },
    }),
    'Email/set': answer('e-'),
    'EmailSubmission/set': answer('s-'),
  });
  const receipts = [];
  for await (const receipt of transport().sendMany([1, 2, 3, 4, 5].map(() => message()))) {
    receipts.push(receipt);
  }
  assert.strictEqual(calls.filter((call) => call === 'Email/set').length, 3);
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful),
    [true, true, false, false, true],
  );
});

test('JMAP: an account ID cannot climb the path of a blob upload', async (t) => {
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    paths.push(new URL(url).pathname);
    return Response.json({ blobId: 'b1' });
  });
  const config = createJmapConfig({ sessionUrl: 'https://jmap.example.com/s', bearerToken: 't' });
  await uploadBlob(
    config,
    'https://jmap.example.com/upload/{accountId}/',
    'a/../../x',
    new Blob(['a']),
  );
  assert.deepStrictEqual(paths, ['/upload/a%2F..%2F..%2Fx/']);
});

test('JMAP: sendMany reads a batch at a time, after one discovery', async (t) => {
  const createdOf = (args) => {
    const created = {};
    for (const key in args.create) created[key] = { id: key, blobId: 'b', threadId: 't' };
    return { created };
  };
  const calls = serve(t, {
    session: session({
      capabilities: { [CORE]: { maxObjectsInSet: 2 }, [MAIL]: {}, [SUBMISSION]: {} },
    }),
    'Email/set': createdOf,
    'EmailSubmission/set': createdOf,
  });
  let read = 0;
  const messages = (async function* () {
    for (let index = 0; index < 1000; index++) {
      read++;
      yield message();
    }
  })();
  const receipts = [];
  for await (const receipt of transport().sendMany(messages)) {
    receipts.push(receipt);
    if (receipts.length === 3) break;
  }
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful),
    [true, true, true],
  );
  // Two batches of two: the third receipt is the first of the second batch.
  assert.strictEqual(read, 4);
  assert.strictEqual(calls.filter((call) => call === 'Mailbox/get').length, 1);
});

test('JMAP: sendMany of nothing discovers nothing', async (t) => {
  const calls = serve(t);
  for await (const receipt of transport().sendMany([])) assert.fail(receipt);
  assert.deepStrictEqual(calls, []);
});

test('JMAP: a retried discovery request is told through onRetry', async (t) => {
  // The shortest jittered wait: half of the first delay.
  t.mock.method(Math, 'random', () => 0);
  let mailboxCalls = 0;
  const handlers = {
    session: session(),
    'Mailbox/get': () => {
      mailboxCalls++;
      return defaults['Mailbox/get']();
    },
  };
  serve(t, handlers);
  const served = globalThis.fetch;
  let failed = false;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (!failed && String(input).endsWith('/api') && init.body.includes('Mailbox/get')) {
      failed = true;
      return new Response('busy', { status: 503 });
    }
    return served(input, init);
  });
  const events = [];
  const receipt = await transport({ retries: 1 }).send(message(), {
    onRetry: (event) => events.push(event),
  });
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(mailboxCalls, 1);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].attempt, 1);
  assert.strictEqual(events[0].error.statusCode, 503);
});

test('JMAP: a batch goes in requests within maxSizeRequest, a message too large alone fails', async (t) => {
  const createdOf = (args) => {
    const created = {};
    for (const key in args.create) created[key] = { id: key, blobId: 'b', threadId: 't' };
    return { created };
  };
  const run = async (maxSizeRequest, messages) => {
    t.mock.restoreAll();
    const core = maxSizeRequest === undefined ? {} : { maxSizeRequest };
    serve(t, {
      session: session({ capabilities: { [CORE]: core, [MAIL]: {}, [SUBMISSION]: {} } }),
      'Email/set': createdOf,
      'EmailSubmission/set': createdOf,
    });
    const served = globalThis.fetch;
    const sizes = [];
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      if (init?.body != null && String(init.body).includes('Email/set')) {
        sizes.push(Buffer.byteLength(String(init.body)));
      }
      return served(input, init);
    });
    const receipts = [];
    for await (const receipt of transport().sendMany(messages)) receipts.push(receipt);
    return { receipts, sizes };
  };
  const five = [message(), message(), message(), message(), message()];
  const whole = await run(undefined, five);
  assert.strictEqual(whole.sizes.length, 1);

  const limit = Math.ceil(whole.sizes[0] / 2);
  const split = await run(limit, five);
  assert.ok(split.sizes.length >= 2, String(split.sizes));
  for (const size of split.sizes) assert.ok(size <= limit, `${size} > ${limit}`);
  assert.deepStrictEqual(
    split.receipts.map((receipt) => receipt.successful),
    [true, true, true, true, true],
  );

  const large = createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Large',
    content: { text: 'x'.repeat(limit) },
  });
  const mixed = await run(limit, [message(), large, message()]);
  assert.deepStrictEqual(
    mixed.receipts.map((receipt) => receipt.successful || receipt.errors[0].code),
    [true, 'jmap.request_too_large', true],
  );
  for (const size of mixed.sizes) assert.ok(size <= limit);

  // A single send is refused before its request too.
  t.mock.restoreAll();
  const calls = serve(t, {
    session: session({
      capabilities: { [CORE]: { maxSizeRequest: limit }, [MAIL]: {}, [SUBMISSION]: {} },
    }),
  });
  const receipt = await transport().send(large);
  assert.strictEqual(receipt.errors[0].code, 'jmap.request_too_large');
  assert.ok(!calls.includes('Email/set'));
});
