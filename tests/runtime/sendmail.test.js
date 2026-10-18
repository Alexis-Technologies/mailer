// Not ported: the sendmail transport on the runtime that runs the test (Node,
// Bun or Deno), spawning a command of its own with no mock: a shell script
// that keeps its arguments and the message it reads, so POSIX only.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMessage } = require('@alexify/mailer');
const { SendmailTransport } = require('@alexify/mailer/sendmail');

const posix = { skip: process.platform === 'win32' && 'the command is a shell script' };

// A sendmail command that runs `body` after keeping its arguments and the
// message next to itself.
const command = (t, body = '') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-sendmail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sendmail');
  const script = `#!/bin/sh\nprintf '%s\\n' "$@" > "$0.args"\ncat > "$0.message"\n${body}\n`;
  fs.writeFileSync(file, script, { mode: 0o755 });
  return file;
};

const message = () =>
  createMessage({
    from: 'shop@example.com',
    to: 'bob@example.com',
    bcc: 'audit@example.com',
    subject: 'Hi',
    content: { text: 'Hello\n.\nStill here' },
  });

test('Runtime sendmail: the message goes to stdin, the recipients after --', posix, async (t) => {
  const file = command(t);
  const receipt = await new SendmailTransport({ path: file }).send(message());
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  const args = fs.readFileSync(`${file}.args`, 'utf8').split('\n');
  assert.deepStrictEqual(args, [
    '-i',
    '-f',
    'shop@example.com',
    '--',
    'bob@example.com',
    'audit@example.com',
    '',
  ]);
  const sent = fs.readFileSync(`${file}.message`, 'utf8');
  assert.match(sent, /^Subject: Hi$/m);
  assert.match(sent, /^Still here$/m);
  assert.doesNotMatch(sent, /^Bcc:/im);
  assert.doesNotMatch(sent, /\r/);
});

test('Runtime sendmail: an exit code or a signal fails the send', posix, async (t) => {
  const refused = command(t, 'echo "bob: user unknown" >&2\nexit 67');
  const receipt = await new SendmailTransport({ path: refused }).send(message());
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.errors[0].category, 'rejected');
  assert.match(receipt.errorMessages[0], /user unknown/);
  // Killed after it read the whole message: it may have queued it.
  const killed = command(t, 'kill -9 $$');
  const lost = await new SendmailTransport({ path: killed }).send(message());
  assert.strictEqual(lost.successful, false);
  assert.strictEqual(lost.deliveryUnknown, true, lost.errorMessages.join());
});
