const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

const run = (script, args) =>
  spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8' });

test('Scripts: size reports the entry and enforces the gzip budget', () => {
  const ok = run('scripts/size.js', ['--max-gzip', '100']);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /\| Node entry \(index\.js\) \|/);

  const over = run('scripts/size.js', ['--max-gzip', '0.01']);
  assert.strictEqual(over.status, 1);
  assert.match(over.stderr, /Bundle budget exceeded: Node entry/);

  const bad = run('scripts/size.js', ['--max-gzip', 'lots']);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /positive number of kilobytes/);
});
