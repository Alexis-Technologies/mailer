// Not ported: the codes of the queue, its drivers and its worker are those
// the table of docs/guide/queue.md lists, and the table lists no other.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const SOURCES = [
  'src/queue',
  'src/bullmq',
  'src/mongodb',
  'src/audit',
  'src/internal/polling-driver.js',
  'src/otel/handler.js',
];
const CODE = /'((?:queue|render|audit)\.[a-z_.]+|MAILER_(?:QUEUE|AUDIT)[A-Z_]*|delivery_unknown)'/g;

const filesOf = (entry) => {
  const full = path.join(ROOT, entry);
  if (!fs.statSync(full).isDirectory()) return [full];
  const files = [];
  for (const name of fs.readdirSync(full)) {
    if (name.endsWith('.js')) files.push(path.join(full, name));
  }
  return files;
};

test('Codes: the table of the queue guide lists the codes of the code, and no other', () => {
  const inCode = new Set();
  for (const entry of SOURCES) {
    for (const file of filesOf(entry)) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(CODE)) inCode.add(match[1]);
    }
  }
  // A state of a message, not a code, where it stands for one.
  const guide = fs.readFileSync(path.join(ROOT, 'docs/guide/queue.md'), 'utf8');
  const table = guide.slice(
    guide.indexOf('<!-- codes:start -->'),
    guide.indexOf('<!-- codes:end -->'),
  );
  const inTable = new Set();
  for (const match of table.matchAll(/^\| `([^`]+)` \|/gm)) inTable.add(match[1]);
  const missing = [...inCode].filter((code) => !inTable.has(code)).toSorted();
  const stale = [...inTable].filter((code) => !inCode.has(code)).toSorted();
  assert.deepStrictEqual({ missing, stale }, { missing: [], stale: [] });
});
