/**
 * Zero-dependency ops/sec benchmark for the mailer's hot paths.
 *
 * Run: pnpm bench [filter] [--json] [--save] [--compare]
 *
 * An optional filter runs only the scenarios whose name contains it, e.g.
 * `pnpm bench MIME`. `--json` prints the results as JSON, `--save` writes
 * them to bench/baseline.json, and `--compare` prints the change against
 * that baseline (numbers are machine-specific: compare on one machine, before
 * and after a change). Manual only, not part of CI.
 *
 * The scenarios run the library itself: composing a message with and
 * without an attachment or a DKIM signature, writing message data through
 * the SMTP dot-stuffing, and the checks that run once per message or per
 * address.
 */

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const { bench, benchAsync, ATTACHMENT_1M, ADDRESS } = require('./helpers.js');
const {
  classifyReceiptError,
  createMessage,
  isEmailAddress,
  readAttachmentContent,
} = require('../index.js');
const { composeMessage } = require('../src/mime/index.js');
const { writeMessageData } = require('../src/smtp/data-stream.js');
const { PriorityStrategy } = require('../src/pool/strategies/priority-strategy.js');

const BASELINE = path.join(__dirname, 'baseline.json');

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const filter = args.find((arg) => !arg.startsWith('--')) || '';
const json = flags.has('--json');

const percent = (current, base) => {
  const delta = ((current - base) / base) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
};

const compare = (results) => {
  if (!fs.existsSync(BASELINE)) {
    console.error(`No baseline at ${BASELINE}; run with --save first`);
    process.exitCode = 1;
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const base = new Map(baseline.results.map((row) => [row.name, row.opsPerSec]));
  console.log(`\nAgainst baseline from ${baseline.date} (${baseline.node}):`);
  for (const { name, opsPerSec } of results) {
    const before = base.get(name);
    const change = before ? percent(opsPerSec, before) : 'no baseline';
    console.log(`${name.padEnd(52)} ${change.padStart(12)}`);
  }
};

const textMessage = createMessage({
  from: 'Acme <no-reply@acme.example>',
  to: 'Алекс <alex@example.com>',
  subject: 'Скидання пароля: перейдіть за посиланням, щоб задати новий',
  content: {
    text: 'Перейдіть за посиланням, щоб скинути пароль: https://acme.example/reset/abc123\n'.repeat(
      20,
    ),
    html: '<p>Перейдіть за <a href="https://acme.example/reset/abc123">посиланням</a>.</p>'.repeat(
      20,
    ),
  },
});

const attachmentMessage = createMessage({
  from: 'no-reply@acme.example',
  to: 'alex@example.com',
  subject: 'Your invoice',
  content: { text: 'The invoice is attached.' },
  attachments: [
    {
      inline: false,
      filename: 'рахунок за жовтень.pdf',
      content: ATTACHMENT_1M,
      contentType: 'application/pdf',
      contentId: '',
    },
  ],
});

const composeAndRead = async (message, options) => {
  const composed = await composeMessage(message, options);
  return readAttachmentContent(composed.content);
};

// A socket that takes every write at once and answers the end of DATA.
const fakeSocket = () => {
  const socket = Object.assign(new EventEmitter(), { destroyed: false, writable: true });
  socket.destroy = () => {};
  socket.write = (chunk, callback) => {
    callback?.();
    if (chunk.length === 3 && chunk[0] === 0x2e) {
      queueMicrotask(() => socket.emit('data', Buffer.from('250 ok\r\n')));
    }
    return true;
  };
  return socket;
};

// One megabyte of text lines, a third of them starting with a dot.
const dottedBody = Buffer.from(
  Array.from({ length: 16384 }, (_, i) => (i % 3 === 0 ? '.' : 'x').repeat(62)).join('\r\n') +
    '\r\n',
);

const main = async () => {
  if (!json) console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dkim = {
    signatures: [
      {
        signingDomain: 'acme.example',
        selector: 'mail',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      },
    ],
  };
  const strategy = new PriorityStrategy();
  const transports = Array.from({ length: 10 }, (_, i) => ({
    transport: { id: `t${i}` },
    enabled: true,
    priority: i % 3,
    weight: 1,
  }));
  const failure = new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }),
  });
  const slow = { warmup: 20 };

  const scenarios = [
    ['MIME — compose a text and HTML message', () => composeAndRead(textMessage), slow],
    [
      'MIME — compose a message with a 1 MiB attachment',
      () => composeAndRead(attachmentMessage),
      slow,
    ],
    [
      'DKIM — compose and sign a text message (RSA-2048)',
      () => composeAndRead(textMessage, { dkim }),
      slow,
    ],
    [
      'SMTP — dot-stuff and write 1 MiB of message data',
      () =>
        writeMessageData(
          fakeSocket(),
          async function* () {
            yield dottedBody;
          },
          60_000,
          () => {},
        ),
      slow,
    ],
    ['Address — isEmailAddress', () => isEmailAddress(ADDRESS)],
    ['Receipt — classifyReceiptError of a reset', () => classifyReceiptError(failure)],
    [
      'Pool — select by priority among 10 transports',
      () => strategy.select(textMessage, transports, new Set()),
    ],
  ];

  const results = [];
  for (const [name, fn, options] of scenarios) {
    if (!name.includes(filter)) continue;
    const isAsync = fn() instanceof Promise;
    const run = isAsync ? benchAsync : bench;
    results.push(await run(name, fn, { ...options, quiet: json }));
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  if (flags.has('--save')) {
    const snapshot = { node: process.version, date: new Date().toISOString(), results };
    fs.writeFileSync(BASELINE, `${JSON.stringify(snapshot, null, 2)}\n`);
    if (!json) console.log(`\nSaved ${results.length} results to ${BASELINE}`);
  }
  if (flags.has('--compare')) compare(results);
};

main();
