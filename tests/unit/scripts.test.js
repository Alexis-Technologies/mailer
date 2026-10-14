const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const pkg = require('../../package.json');

const ROOT = path.join(__dirname, '../..');

const run = (script, args) =>
  spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8' });

test('Scripts: a subpath is measured on top of the root entry', async () => {
  const { subpathsOf, extrasOf } = require('../../scripts/size.js');
  const subpaths = subpathsOf({
    '.': { types: './index.d.ts', default: './index.js' },
    './smtp': { types: './src/smtp/index.d.ts', default: './src/smtp/index.js' },
    './mime': { types: './src/mime/index.d.ts', default: './src/mime/index.js' },
  });
  assert.deepStrictEqual(
    subpaths.map(({ label, subpath, flag }) => [label, subpath, flag]),
    [
      ['Smtp (./smtp) on top of the Node entry', './src/smtp/index.js', '--max-gzip-smtp'],
      ['Mime (./mime) on top of the Node entry', './src/mime/index.js', '--max-gzip-mime'],
    ],
  );
  // A fake measure: a size per subpath in the bundle, over a core of 1000.
  const sizes = { './src/smtp/index.js': 400, './src/mime/index.js': 70 };
  const size = (entry, list) => {
    let total = 1000;
    for (const subpath of list) total += sizes[subpath];
    return { label: entry.label, raw: total * 3, min: total * 2, gzip: total };
  };
  const core = { label: 'core', raw: 3000, min: 2000, gzip: 1000 };
  const extras = await extrasOf(core, size, subpaths);
  assert.deepStrictEqual(
    extras.map(({ gzip, min, raw, max }) => [gzip, min, raw, max]),
    [
      [400, 800, 1200, null],
      [70, 140, 210, null],
    ],
  );
});

test('Scripts: size reports the entries and enforces the gzip budgets', () => {
  const { SUBPATHS } = require('../../scripts/size.js');
  const budgets = ['--max-gzip', '100'];
  for (const { flag } of SUBPATHS) budgets.push(flag, '100');
  const ok = run('scripts/size.js', budgets);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /\| Node entry \(index\.js\) \|/);
  for (const { label } of SUBPATHS) assert.ok(ok.stdout.includes(`| ${label} |`), label);

  const over = run('scripts/size.js', ['--max-gzip', '0.01']);
  assert.strictEqual(over.status, 1);
  assert.match(over.stderr, /Bundle budget exceeded: Node entry/);

  for (const { flag, label } of SUBPATHS) {
    const subpathOver = run('scripts/size.js', [flag, '0.01']);
    assert.strictEqual(subpathOver.status, 1, flag);
    assert.ok(subpathOver.stderr.includes(`Bundle budget exceeded: ${label}`), flag);
  }

  const bad = run('scripts/size.js', ['--max-gzip', 'lots']);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /positive number of kilobytes/);
});

test('Scripts: check-dts compiles the types of every entry of the exports map', () => {
  const { typesOf } = require('../../scripts/check-dts.js');
  assert.deepStrictEqual(
    typesOf(pkg.exports),
    Object.values(pkg.exports).map((entry) => entry.types),
  );
  assert.strictEqual(typesOf(pkg.exports)[0], './index.d.ts');
});
