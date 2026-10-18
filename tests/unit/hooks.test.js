// Not ported: tests of ./hooks, ported from sently's mailer hooks, against a
// fake transport.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { HooksTransport } = require('../../src/hooks/index.js');
const { collect, failed, fakeTransport, sent } = require('../helpers/decorators/fake.js');

const message = (subject = 'Hello') =>
  createMessage({ from: 'a@example.com', to: 'b@example.com', subject, content: { text: 'x' } });

test('Hooks: beforeSend may replace the message, afterSend hears the receipt', async () => {
  const inner = fakeTransport();
  const heard = [];
  let time = 100;
  const hooked = new HooksTransport(inner, {
    beforeSend: (m) => (m.subject === 'swap' ? message('swapped') : undefined),
    afterSend: async (receipt, m, context) => {
      heard.push([receipt.messageId, m.subject, context.operation, context.startedAt]);
    },
    now: () => time++,
  });
  await hooked.send(message('keep'));
  await hooked.send(message('swap'));
  assert.deepStrictEqual(
    inner.calls.map((call) => call.message.subject),
    ['keep', 'swapped'],
  );
  assert.deepStrictEqual(heard, [
    ['m0', 'keep', 'send', 100],
    ['m1', 'swapped', 'send', 101],
  ]);
});

test('Hooks: a beforeSend that throws refuses the message, unsent', async () => {
  const inner = fakeTransport();
  const hooked = new HooksTransport(inner, {
    beforeSend: (m) => {
      if (m.subject === 'suppressed') throw new Error('on the suppression list');
      if (m.subject === 'odd') return 'not a message';
      return undefined;
    },
  });
  const refused = await hooked.send(message('suppressed'));
  assert.strictEqual(refused.successful, false);
  assert.strictEqual(refused.retryable, false);
  assert.strictEqual(refused.errors[0].category, 'rejected');
  assert.strictEqual(refused.errors[0].code, 'hooks.refused');
  assert.strictEqual(
    refused.errorMessages[0],
    'The beforeSend hook refused the message: on the suppression list',
  );
  const odd = await hooked.send(message('odd'));
  assert.match(odd.errorMessages[0], /returned neither a message nor nothing/);
  assert.strictEqual(inner.calls.length, 0);
  const literal = new HooksTransport(inner, {
    beforeSend: () => {
      // oxlint-disable-next-line no-throw-literal -- a hook may throw anything
      throw 'no';
    },
  });
  assert.match((await literal.send(message())).errorMessages[0], /refused the message: no$/);
});

test('Hooks: each send hears its own retries, the caller still hears them all', async () => {
  // Changed in the port: sently set onRetry on the shared transport, so of two
  // concurrent sends, one heard the other's retries.
  const inner = fakeTransport(async (m, _index, options) => {
    await new Promise((resolve) => setImmediate(resolve));
    options?.onRetry?.({ attempt: 1, delayMilliseconds: 10, error: new Error(m.subject) });
    return sent(m.subject);
  });
  const heard = [];
  const callerHeard = [];
  const hooked = new HooksTransport(inner, {
    beforeSend: () => undefined,
    onRetry: (event, context) => {
      heard.push([event.error.message, context.operation]);
      if (event.error.message === 'b') throw new Error('hook broke');
    },
  });
  const warnings = [];
  const original = process.emitWarning;
  process.emitWarning = (text, options) => warnings.push([text, options.code]);
  try {
    await Promise.all([
      hooked.send(message('a'), { onRetry: (event) => callerHeard.push(event.error.message) }),
      hooked.send(message('b'), { onRetry: (event) => callerHeard.push(event.error.message) }),
    ]);
  } finally {
    process.emitWarning = original;
  }
  assert.deepStrictEqual(heard.sort(), [
    ['a', 'send'],
    ['b', 'send'],
  ]);
  assert.deepStrictEqual(callerHeard.sort(), ['a', 'b']);
  assert.deepStrictEqual(warnings, [
    ['The onRetry hook of HooksTransport threw: hook broke', 'MAILER_HOOK_FAILED'],
  ]);
  // Without an onRetry hook, the options go as they are.
  const plain = new HooksTransport(inner);
  const options = { signal: new AbortController().signal };
  await plain.send(message('c'), options);
  assert.strictEqual(inner.calls.at(-1).options, options);
});

test('Hooks: a hook that throws after the send is a warning, the receipt stands', async (t) => {
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text, options) => warnings.push([text, options.code]));
  const inner = fakeTransport((m) =>
    m.subject === 'boom' ? { throw: new Error('socket') } : sent('ok'),
  );
  const onError = [];
  const hooked = new HooksTransport(inner, {
    afterSend: () => {
      throw new Error('audit down');
    },
    onError: async (error, m, context) => {
      onError.push([error.message, m.subject, context.operation]);
      throw new Error('alert down');
    },
  });
  assert.strictEqual((await hooked.send(message())).messageId, 'ok');
  await assert.rejects(hooked.send(message('boom')), /socket/);
  assert.deepStrictEqual(onError, [['socket', 'boom', 'send']]);
  assert.deepStrictEqual(warnings, [
    ['The afterSend hook of HooksTransport threw: audit down', 'MAILER_HOOK_FAILED'],
    ['The onError hook of HooksTransport threw: alert down', 'MAILER_HOOK_FAILED'],
  ]);
});

test('Hooks: sendMany calls the hooks of each message, through the wrapped sendMany', async () => {
  const inner = fakeTransport(
    (m, index) => (m.subject === 'bad' ? failed('validation') : sent(`m${index}`)),
    {
      readAhead: 1,
    },
  );
  const after = [];
  const retries = [];
  const hooked = new HooksTransport(inner, {
    beforeSend: (m) => {
      if (m.subject === 'refuse') throw new Error('no');
    },
    afterSend: (receipt, m, context) =>
      after.push([m.subject, receipt.successful, context.operation]),
    onRetry: (_event, context) => retries.push(context.operation),
  });
  const receipts = await collect(
    hooked.sendMany([message('one'), message('refuse'), message('bad'), message('two')]),
  );
  assert.deepStrictEqual(
    receipts.map(
      (receipt) => receipt.successful || receipt.errors[0].code || receipt.errors[0].category,
    ),
    [true, 'hooks.refused', 'validation', true],
  );
  assert.deepStrictEqual(after, [
    ['one', true, 'sendMany'],
    ['bad', false, 'sendMany'],
    ['two', true, 'sendMany'],
  ]);
  assert.ok(inner.calls.every((call) => typeof call.options.onRetry === 'function'));
  inner.calls[0].options.onRetry({ attempt: 1, delayMilliseconds: 1, error: new Error('x') });
  assert.deepStrictEqual(retries, ['sendMany']);
  const errors = [];
  const exploding = new HooksTransport(
    fakeTransport(undefined, {
      overrides: {
        // oxlint-disable-next-line require-yield
        async *sendMany(messages) {
          await messages[Symbol.asyncIterator]().next();
          throw new Error('batch exploded');
        },
      },
    }),
    { onError: (error, m) => errors.push([error.message, m.subject]) },
  );
  await assert.rejects(collect(exploding.sendMany([message('x')])), /batch exploded/);
  assert.deepStrictEqual(errors, [['batch exploded', 'x']]);
});

test('Hooks: sendRaw, verify, dispose and the options', async () => {
  const inner = fakeTransport();
  const raws = [];
  const hooked = new HooksTransport(inner, {
    beforeSendRaw: (raw) => ({ ...raw, envelope: { ...raw.envelope, to: ['c@example.com'] } }),
    afterSend: (_receipt, raw, context) => raws.push([raw.envelope.to[0], context.operation]),
  });
  const raw = { envelope: { from: 'a@example.com', to: ['b@example.com'] }, content: 'x' };
  await hooked.sendRaw(raw);
  assert.deepStrictEqual(inner.calls[0].message.envelope.to, ['c@example.com']);
  assert.deepStrictEqual(raws, [['c@example.com', 'sendRaw']]);
  const refusing = new HooksTransport(inner, {
    beforeSendRaw: () => {
      throw new Error('no raw');
    },
  });
  assert.match((await refusing.sendRaw(raw)).errorMessages[0], /beforeSendRaw hook refused/);
  await hooked.verify();
  assert.strictEqual(inner.verified, 1);
  await hooked[Symbol.asyncDispose]();
  assert.strictEqual(inner.disposed, 1);
  const plain = { id: 'plain', send: async () => sent('p') };
  const bare = new HooksTransport(plain);
  assert.strictEqual((await bare.sendRaw(raw)).errors[0].category, 'configuration');
  await bare.verify();
  await bare[Symbol.asyncDispose]();
  let disposed = 0;
  await new HooksTransport({ ...plain, [Symbol.dispose]: () => disposed++ })[Symbol.asyncDispose]();
  assert.strictEqual(disposed, 1);
  assert.strictEqual(new HooksTransport(inner).id, 'fake');
  assert.throws(
    () => new HooksTransport(inner, { afterSend: 'log' }),
    /afterSend must be a function/,
  );
  await assert.rejects(
    bare.send(message(), { signal: AbortSignal.abort(new Error('already')) }),
    /already/,
  );
});

test('Hooks: a message a batch left before its answer ends with onError', async () => {
  // Before: neither afterSend nor onError heard of it.
  const errors = [];
  const hooks = new HooksTransport(fakeTransport(undefined, { readAhead: 2 }), {
    onError: (error, sentMessage) => errors.push([error.name, sentMessage.subject]),
  });
  for await (const receipt of hooks.sendMany([message('a'), message('b'), message('c')])) {
    if (receipt.successful) break;
  }
  assert.deepStrictEqual(errors, [
    ['AbortError', 'b'],
    ['AbortError', 'c'],
  ]);
});

test('Hooks: the context carries the signal, an abort during beforeSend sends nothing', async () => {
  // Before: a hook had no signal to heed, and an abort while it ran still
  // sent the message.
  const inner = fakeTransport();
  const controller = new AbortController();
  let seen;
  const hooks = new HooksTransport(inner, {
    beforeSend: async (sentMessage, context) => {
      seen = context.signal;
      controller.abort(new Error('gone'));
    },
  });
  await assert.rejects(hooks.send(message(), { signal: controller.signal }), /gone/);
  assert.strictEqual(seen, controller.signal);
  assert.strictEqual(inner.calls.length, 0);
});

test('Hooks: a beforeSend that returns something else than a message refuses it', async () => {
  // Before: any object went on as the message, past the checks of createMessage.
  const inner = fakeTransport();
  const hooks = new HooksTransport(inner, { beforeSend: () => ({ subject: 'not a message' }) });
  const receipt = await hooks.send(message());
  assert.strictEqual(receipt.errors[0].code, 'hooks.refused');
  assert.strictEqual(inner.calls.length, 0);
});

test('Hooks: a copy a beforeSend returns is checked again as createMessage checks it', async () => {
  // Before: a copy with fields changed kept the shape of a message, so a
  // line break in a name or an address, or in the content type of an
  // attachment, reached transports that rely on createMessage refusing it.
  const inner = fakeTransport();
  const copies = [
    (m) => ({ ...m, sender: { name: 'Eve\r\nBcc: x@evil.example', address: 'a@example.com' } }),
    (m) => ({ ...m, recipients: [{ address: 'b@example.com\r\nBcc: x@evil.example' }] }),
    (m) => ({
      ...m,
      attachments: [
        {
          filename: 'a.txt',
          contentType: 'text/plain\r\nX-Evil: 1',
          content: new Uint8Array(1),
          inline: false,
          contentId: '',
        },
      ],
    }),
    (m) => ({ ...m, headers: { 'X-Plain': 'object' } }),
    (m) => ({ ...m, metadata: { 'bad key': 'x' } }),
  ];
  for (const copy of copies) {
    const hooks = new HooksTransport(inner, { beforeSend: copy });
    const receipt = await hooks.send(message());
    assert.strictEqual(receipt.errors[0].code, 'hooks.refused', String(copy));
    assert.match(receipt.errorMessages[0], /returned an invalid message/);
  }
  assert.strictEqual(inner.calls.length, 0);
  // A sound copy goes.
  const fine = new HooksTransport(inner, { beforeSend: (m) => ({ ...m, subject: 'Changed' }) });
  assert.strictEqual((await fine.send(message())).successful, true);
  assert.strictEqual(inner.calls[0].message.subject, 'Changed');
});

test('Hooks: an onRetry hook whose promise rejects is a warning', async (t) => {
  // Before: the rejection of an async onRetry hook went unhandled.
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text, options) => warnings.push(options.code));
  const inner = fakeTransport(async (_message, _index, options) => {
    options.onRetry({ attempt: 1, delayMilliseconds: 0, error: new Error('busy') });
    return sent('m');
  });
  const hooks = new HooksTransport(inner, { onRetry: async () => Promise.reject(new Error('no')) });
  await hooks.send(message());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(warnings, ['MAILER_HOOK_FAILED']);
});
