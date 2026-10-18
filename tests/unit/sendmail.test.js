// Not ported: tests of ./sendmail, ported from nodemailer's sendmail
// transport, with a fake `spawn` and with a real process that stands in for
// sendmail.
const { test } = require('node:test');
const assert = require('node:assert');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const { PassThrough } = require('node:stream');
const { createMessage } = require('../../index.js');
const { SendmailTransport } = require('../../src/sendmail/index.js');
const {
  TEST_DKIM_PRIVATE_KEY,
  TEST_DKIM_PUBLIC_KEY,
} = require('../helpers/mime/dkim-test-keys.js');
const { verifyDkim } = require('../helpers/mime/verify-dkim.js');

const message = (fields = {}) =>
  createMessage({
    from: 'alex@example.com',
    to: ['bob@example.com', 'carol@example.com'],
    bcc: 'blind@example.com',
    subject: 'Hello',
    content: { text: 'line one\r\nline two\r\n.\r\nend' },
    ...fields,
  });

// A fake child: what is written to stdin is kept, and `exit` decides how the
// process ends once its input ends.
const fakeSpawn = (exit = { code: 0 }) => {
  const calls = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    const chunks = [];
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = [];
    child.kill = (signal = 'SIGTERM') => {
      child.killed.push(signal);
      setImmediate(() => child.emit('close', null, signal));
      return true;
    };
    child.stdin.on('data', (chunk) => chunks.push(chunk));
    child.stdin.on('end', () => {
      if (exit.stderr !== undefined) child.stderr.write(exit.stderr);
      if (exit.hang) return;
      setImmediate(() => child.emit('close', exit.code ?? null, exit.signal ?? null));
    });
    calls.push({ command, args, options, child, input: () => Buffer.concat(chunks).toString() });
    return child;
  };
  return { spawn, calls };
};

test('Sendmail: pipes the composed message with -i, -f and -- before the recipients', async () => {
  const { spawn, calls } = fakeSpawn();
  const transport = new SendmailTransport({ path: '/usr/sbin/sendmail', spawn });
  const receipt = await transport.send(message());
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.strictEqual(receipt.provider, 'sendmail');
  const [call] = calls;
  assert.strictEqual(call.command, '/usr/sbin/sendmail');
  assert.deepStrictEqual(call.args, [
    '-i',
    '-f',
    'alex@example.com',
    '--',
    'bob@example.com',
    'carol@example.com',
    'blind@example.com',
  ]);
  assert.deepStrictEqual(call.options.stdio, ['pipe', 'ignore', 'pipe']);
  const input = call.input();
  // LF line endings, no Bcc field, the receipt's Message-ID in the message.
  assert.ok(!input.includes('\r\n'));
  assert.ok(input.includes('\nline one\nline two\n.\nend'));
  assert.ok(!/^Bcc:/im.test(input));
  assert.ok(input.includes(`Message-ID: <${receipt.messageId}>`));
});

test('Sendmail: crlf keeps CRLF, and args replace -f', async () => {
  const { spawn, calls } = fakeSpawn();
  const transport = new SendmailTransport({ newline: 'crlf', args: ['-oi', '-t'], spawn });
  assert.strictEqual((await transport.send(message({ bcc: undefined }))).successful, true);
  assert.deepStrictEqual(calls[0].args, [
    '-i',
    '-oi',
    '-t',
    '--',
    'bob@example.com',
    'carol@example.com',
  ]);
  assert.strictEqual(calls[0].command, 'sendmail');
  assert.ok(calls[0].input().includes('line one\r\nline two\r\n'));
});

test('Sendmail: sendRaw pipes the bytes, CRLF as LF across chunks, -f <> for no sender', async () => {
  const { spawn, calls } = fakeSpawn();
  const transport = new SendmailTransport({ spawn, generateId: () => 'raw-1' });
  const encoder = new TextEncoder();
  const receipt = await transport.sendRaw({
    envelope: { from: null, to: ['bob@example.com'] },
    content: async function* () {
      yield encoder.encode('Subject: Raw\r');
      yield encoder.encode('\nTo: bob@example.com\r\n\r\nbody\r');
      yield encoder.encode('\n');
    },
  });
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.strictEqual(receipt.messageId, 'raw-1');
  assert.deepStrictEqual(calls[0].args, ['-i', '-f', '<>', '--', 'bob@example.com']);
  assert.strictEqual(calls[0].input(), 'Subject: Raw\nTo: bob@example.com\n\nbody\n');
  const invalid = await transport.sendRaw({
    envelope: { from: null, to: [] },
    content: new Uint8Array(),
  });
  assert.strictEqual(invalid.successful, false);
  assert.strictEqual(invalid.errors[0].category, 'validation');
});

test('Sendmail: an address that reads as an option never reaches the command line', async () => {
  const { spawn, calls } = fakeSpawn();
  const transport = new SendmailTransport({ spawn });
  for (const to of ['-oQ/tmp@example.com', '"-bv"@example.com']) {
    const receipt = await transport.sendRaw({
      envelope: { from: 'a@example.com', to: [to] },
      content: new TextEncoder().encode('Subject: x\r\n\r\nx\r\n'),
    });
    assert.strictEqual(receipt.successful, false, to);
    assert.match(receipt.errorMessages.join(), /must not start with "-"/);
  }
  const sender = await transport.send(message({ from: '-f@example.com' }));
  assert.match(sender.errorMessages.join(), /must not start with "-"/);
  assert.strictEqual(calls.length, 0);
});

test('Sendmail: the exit status says what failed, with stderr, addresses redacted', async () => {
  const cases = [
    [{ code: 75, stderr: 'queue full' }, 'service-unavailable', true],
    [{ code: 69 }, 'service-unavailable', true],
    [{ code: 67, stderr: 'bob@example.com... User unknown' }, 'rejected', false],
    [{ code: 68 }, 'rejected', false],
    [{ code: 65 }, 'validation', false],
    [{ code: 64 }, 'configuration', false],
    [{ code: 78 }, 'configuration', false],
    [{ code: 127 }, 'configuration', false],
    [{ code: 1, stderr: 'odd' }, 'server-error', false],
  ];
  for (const [exit, category, retryable] of cases) {
    const { spawn } = fakeSpawn(exit);
    const receipt = await new SendmailTransport({ spawn }).send(message());
    assert.strictEqual(receipt.successful, false, `code ${exit.code}`);
    assert.strictEqual(receipt.errors[0].category, category, `code ${exit.code}`);
    assert.strictEqual(receipt.retryable, retryable, `code ${exit.code}`);
    assert.match(receipt.errorMessages[0], new RegExp(`exited with code ${exit.code}`));
  }
  const { spawn } = fakeSpawn({
    code: 67,
    stderr: `bob@example.com... User unknown${'x'.repeat(9000)}`,
  });
  const receipt = await new SendmailTransport({ spawn }).send(message());
  assert.ok(!receipt.errorMessages[0].includes('bob@example.com'));
  assert.ok(receipt.errorMessages[0].includes('User unknown'));
  assert.ok(receipt.errorMessages[0].length < 4200);
});

test('Sendmail: a full pipe is waited for, and a process that leaves early ends the write', async () => {
  const big = message({ content: { text: 'x'.repeat(200_000) } });
  const chunks = [];
  const slow = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough({ highWaterMark: 16 });
    child.stderr = new PassThrough();
    child.kill = () => true;
    // A reader that takes a chunk at a time, later.
    const read = () => {
      const chunk = child.stdin.read();
      if (chunk !== null) chunks.push(chunk);
    };
    child.stdin.on('readable', () => setImmediate(read));
    child.stdin.on('end', () => setImmediate(() => child.emit('close', 0, null)));
    return child;
  };
  const receipt = await new SendmailTransport({ spawn: slow }).send(big);
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.ok(Buffer.concat(chunks).toString().includes('xxxx'));
  const leaving = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough({ highWaterMark: 16 });
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.stdin.once('data', () => {
      child.stdin.destroy();
      child.emit('close', 75, null);
    });
    return child;
  };
  const early = await new SendmailTransport({ spawn: leaving }).send(big);
  assert.strictEqual(early.successful, false);
  assert.strictEqual(early.retryable, true);
});

test('Sendmail: a process killed by a signal is a failure, unknown once it had the message', async () => {
  // nodemailer took `code === null` for success.
  const { spawn } = fakeSpawn({ code: null, signal: 'SIGKILL' });
  const receipt = await new SendmailTransport({ spawn }).send(message());
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.deliveryUnknown, true);
  assert.strictEqual(receipt.retryable, false);
  assert.match(receipt.errorMessages[0], /killed by SIGKILL/);
});

test('Sendmail: a command that is missing, or a spawn that throws, fails the send', async () => {
  const missing = (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = null;
    child.kill = () => true;
    setImmediate(() =>
      child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })),
    );
    return child;
  };
  const receipt = await new SendmailTransport({ path: '/nowhere/sendmail', spawn: missing }).send(
    message(),
  );
  assert.strictEqual(receipt.errorMessages[0], 'sendmail was not found: /nowhere/sendmail');
  assert.strictEqual(receipt.errors[0].category, 'configuration');
  assert.strictEqual(receipt.retryable, false);
  const other = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = null;
    child.kill = () => true;
    setImmediate(() => child.emit('error', new Error('spawn EACCES')));
    return child;
  };
  assert.match(
    (await new SendmailTransport({ spawn: other }).send(message())).errorMessages[0],
    /EACCES/,
  );
  const throwing = () => {
    throw new Error('cannot spawn');
  };
  assert.match(
    (await new SendmailTransport({ spawn: throwing }).send(message())).errorMessages[0],
    /cannot spawn/,
  );
});

test('Sendmail: an abort kills the process, and a content error keeps it from delivering', async () => {
  const { spawn, calls } = fakeSpawn({ hang: true });
  const controller = new AbortController();
  const sending = new SendmailTransport({ spawn }).send(message(), { signal: controller.signal });
  setTimeout(() => controller.abort(new Error('stopped')), 10);
  await assert.rejects(sending, /stopped/);
  assert.deepStrictEqual(calls[0].child.killed, ['SIGTERM']);
  const broken = createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'Broken',
    content: { text: 'x' },
    attachments: {
      filename: 'a.bin',
      contentType: 'application/octet-stream',
      inline: false,
      contentId: '',
      content: async function* () {
        yield new Uint8Array(10);
        throw new Error('disk gone');
      },
    },
  });
  const second = fakeSpawn({ hang: true });
  const receipt = await new SendmailTransport({ spawn: second.spawn }).send(broken);
  assert.strictEqual(receipt.successful, false);
  assert.match(receipt.errorMessages[0], /disk gone/);
  assert.deepStrictEqual(second.calls[0].child.killed, ['SIGINT']);
  const aborted = new AbortController();
  aborted.abort(new Error('early'));
  await assert.rejects(
    new SendmailTransport({ spawn }).send(message(), { signal: aborted.signal }),
    /early/,
  );
});

test('Sendmail: a scheduled message is refused, sendMany sends in turn, DKIM signs', async () => {
  const { spawn, calls } = fakeSpawn();
  const transport = new SendmailTransport({
    spawn,
    dkim: {
      signatures: [
        { signingDomain: 'example.com', selector: 'test', privateKey: TEST_DKIM_PRIVATE_KEY },
      ],
    },
  });
  const scheduled = await transport.send(message({ scheduledAt: new Date() }));
  assert.match(scheduled.errorMessages[0], /Unsupported scheduledAt: sendmail cannot schedule/);
  assert.strictEqual(scheduled.errors[0].category, 'unsupported');
  assert.strictEqual(scheduled.retryable, false);
  const receipts = [];
  for await (const receipt of transport.sendMany([message(), message()])) receipts.push(receipt);
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful),
    [true, true],
  );
  assert.strictEqual(calls.length, 2);
  verifyDkim(calls[0].input().replace(/\n/g, '\r\n'), TEST_DKIM_PUBLIC_KEY);
  // The key does not show in a dump of the transport.
  assert.ok(!JSON.stringify(transport).includes('PRIVATE KEY'));
  assert.ok(!util.inspect(transport, { depth: 10 }).includes('PRIVATE KEY'));
});

test('Sendmail: a real process gets the message on stdin and the arguments', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-sendmail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'fake-sendmail.js');
  const output = path.join(dir, 'out.json');
  fs.writeFileSync(
    script,
    `const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({
    args: process.argv.slice(2), body: Buffer.concat(chunks).toString() }));
  process.stderr.write('Mail queued');
  process.exit(Number(process.env.FAKE_EXIT ?? 0));
});`,
  );
  const spawn = (command, args, options) =>
    childProcess.spawn(process.execPath, [script, ...args], options);
  const transport = new SendmailTransport({ spawn });
  const receipt = await transport.send(message({ attachments: [] }));
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  const seen = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.deepStrictEqual(seen.args.slice(0, 4), ['-i', '-f', 'alex@example.com', '--']);
  assert.ok(seen.body.includes('Subject: Hello\n'));
  process.env.FAKE_EXIT = '75';
  t.after(() => delete process.env.FAKE_EXIT);
  const temporary = await transport.send(message());
  assert.strictEqual(temporary.retryable, true);
  assert.match(temporary.errorMessages[0], /code 75: Mail queued/);
});

test('Sendmail: verify finds the command on PATH or at its path', async (t) => {
  await new SendmailTransport({ path: process.execPath }).verify();
  await assert.rejects(new SendmailTransport({ path: '/nowhere/sendmail' }).verify(), /not found/);
  if (process.platform !== 'win32') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-path-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'my-sendmail'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'not-executable'), '', { mode: 0o644 });
    const saved = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${saved}`;
    t.after(() => {
      process.env.PATH = saved;
    });
    await new SendmailTransport({ path: 'my-sendmail' }).verify();
    await assert.rejects(new SendmailTransport({ path: 'not-executable' }).verify(), /not found/);
  }
  // With spawn passed in, what runs is the caller's to know.
  await new SendmailTransport({ path: 'whatever', spawn: fakeSpawn().spawn }).verify();
  const aborted = new AbortController();
  aborted.abort(new Error('stop'));
  await assert.rejects(new SendmailTransport().verify({ signal: aborted.signal }), /stop/);
});

test('Sendmail: the options are checked when the transport is made', () => {
  const invalid = [
    [{ path: '' }, /path must name/],
    [{ path: 'a\0b' }, /path must name/],
    [{ newline: 'cr' }, /newline must be/],
    [{ args: '-t' }, /args must be an array/],
    [{ args: ['-t', 'a\0'] }, /argument at index 1/],
    [{ spawn: 'sh' }, /spawn must be a function/],
    [
      {
        dkim: { signatures: [{ signingDomain: 'example.com', selector: 's;x', privateKey: 'k' }] },
      },
      /selector/,
    ],
  ];
  for (const [config, error] of invalid) {
    assert.throws(() => new SendmailTransport(config), error, JSON.stringify(config));
  }
  assert.strictEqual(new SendmailTransport().id, 'sendmail');
});

test('Sendmail: a process that does not exit in time is stopped, of unknown delivery', async () => {
  // Before: a sendmail that hung held the send for good, unless the caller
  // passed a signal.
  const { spawn, calls } = fakeSpawn({ hang: true });
  const transport = new SendmailTransport({ spawn, timeout: 20 });
  const receipt = await transport.send(message());
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.errors[0].category, 'timeout');
  assert.strictEqual(receipt.deliveryUnknown, true);
  assert.deepStrictEqual(calls[0].child.killed, ['SIGTERM']);
  assert.throws(() => new SendmailTransport({ timeout: -1 }), /timeout/);
  assert.throws(() => new SendmailTransport({ maxConcurrent: 0 }), /maxConcurrent/);
});

test('Sendmail: a process that ignores SIGTERM gets SIGKILL after a grace', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  const children = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = [];
    child.kill = (signal) => {
      child.killed.push(signal);
      if (signal === 'SIGKILL') setImmediate(() => child.emit('close', null, signal));
      return true;
    };
    children.push(child);
    return child;
  };
  const controller = new AbortController();
  const sending = new SendmailTransport({ spawn }).send(message(), { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('stop'));
  await assert.rejects(sending, /stop/);
  assert.deepStrictEqual(children[0].killed, ['SIGTERM']);
  t.mock.timers.tick(5000);
  assert.deepStrictEqual(children[0].killed, ['SIGTERM', 'SIGKILL']);
});

test('Sendmail: an exit with 0 before the whole message was read is not a success', async () => {
  // Before: code 0 was success whatever had been written.
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    // It closes its input at once, and exits with 0.
    setImmediate(() => {
      child.stdin.destroy();
      setImmediate(() => child.emit('close', 0, null));
    });
    return child;
  };
  const big = message({ content: { text: 'x'.repeat(4 * 1024 * 1024) } });
  const receipt = await new SendmailTransport({ spawn }).send(big);
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.deliveryUnknown, true);
  assert.match(receipt.errorMessages[0], /before it read the whole message/);
});

test('Sendmail: no more than maxConcurrent processes run at once', async () => {
  // Before: every concurrent send spawned its process.
  let running = 0;
  let most = 0;
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    running++;
    most = Math.max(most, running);
    child.stdin.resume();
    child.stdin.on('end', () =>
      setTimeout(() => {
        running--;
        child.emit('close', 0, null);
      }, 5),
    );
    return child;
  };
  const transport = new SendmailTransport({ spawn, maxConcurrent: 2 });
  const receipts = await Promise.all([1, 2, 3, 4, 5].map(() => transport.send(message())));
  assert.ok(receipts.every((receipt) => receipt.successful));
  assert.strictEqual(most, 2);
  // A send that waits for a place leaves the queue when it is aborted.
  const controller = new AbortController();
  const held = [transport.send(message()), transport.send(message())];
  const queued = transport.send(message(), { signal: controller.signal });
  controller.abort(new Error('gone'));
  await assert.rejects(queued, /gone/);
  await Promise.all(held);
});

test('Sendmail: a send that waits for a place leaves the queue when it is aborted', async () => {
  const children = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.stdin.resume();
    children.push(child);
    return child;
  };
  const transport = new SendmailTransport({ spawn, maxConcurrent: 1 });
  const held = transport.send(message());
  while (children.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const controller = new AbortController();
  const queued = transport.send(message(), { signal: controller.signal });
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('gone'));
  await assert.rejects(queued, /gone/);
  // A signal aborted by the time no place is free is refused at once.
  const envelope = { from: 'a@example.com', to: ['b@example.com'] };
  const late = AbortSignal.abort(new Error('late'));
  await assert.rejects(transport.deliver(envelope, [], 'id', late), /late/);
  children[0].stdin.on('finish', () => children[0].emit('close', 0, null));
  if (children[0].stdin.writableFinished) children[0].emit('close', 0, null);
  assert.strictEqual((await held).successful, true);
  assert.strictEqual(children.length, 1);
});
