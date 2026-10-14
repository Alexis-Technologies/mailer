/**
 * Zero-dependency ops/sec benchmark for the mailer's hot paths.
 *
 * Run: pnpm bench [filter] [--json] [--save] [--compare]
 *
 * An optional filter runs only the scenarios whose name contains it, e.g.
 * `pnpm bench base64`. `--json` prints the results as JSON, `--save` writes
 * them to bench/baseline.json, and `--compare` prints the change against
 * that baseline (numbers are machine-specific: compare on one machine, before
 * and after a change). Manual only, not part of CI.
 *
 * Until the MIME builder and the reliability layer are implemented, the
 * scenarios are the reference points their hot paths are made of: encoding
 * an attachment, a Message-ID, a DKIM signature, the hashes of the audit log
 * and the JSON of an outbox record.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  bench,
  ATTACHMENT_100K,
  ATTACHMENT_1M,
  ADDRESS,
  OUTBOX_RECORD,
  DKIM_HEADERS,
} = require('./helpers.js');

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

// RFC 2045: base64 body lines are at most 76 characters, CRLF-separated.
const LINE = 76;
const base64Lines = (buffer) => {
  const text = buffer.toString('base64');
  const lines = [];
  for (let i = 0; i < text.length; i += LINE) lines.push(text.slice(i, i + LINE));
  return lines.join('\r\n');
};

const main = () => {
  if (!json) console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const hmacKey = crypto.randomBytes(32);
  const recordJson = JSON.stringify(OUTBOX_RECORD);
  const slow = { warmup: 50 };

  const scenarios = [
    ['base64, 76-column lines — 100 KB attachment', () => base64Lines(ATTACHMENT_100K), slow],
    ['base64, 76-column lines — 1 MB attachment', () => base64Lines(ATTACHMENT_1M), slow],
    ['Message-ID — crypto.randomUUID()', () => `<${crypto.randomUUID()}@acme.example>`],
    [
      'DKIM — RSA-SHA256 signature, 2048-bit key',
      () => crypto.sign('sha256', Buffer.from(DKIM_HEADERS), privateKey),
      slow,
    ],
    [
      'Audit log — SHA-256 of an outbox record',
      () => crypto.createHash('sha256').update(recordJson).digest('hex'),
    ],
    [
      'Audit log — HMAC-SHA256 of an address',
      () => crypto.createHmac('sha256', hmacKey).update(ADDRESS).digest('hex'),
    ],
    ['Outbox — JSON.stringify of a record', () => JSON.stringify(OUTBOX_RECORD)],
    ['Outbox — JSON.parse of a record', () => JSON.parse(recordJson)],
  ];

  const results = [];
  for (const [name, fn, options] of scenarios) {
    if (name.includes(filter)) results.push(bench(name, fn, { ...options, quiet: json }));
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
