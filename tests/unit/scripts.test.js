const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
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
    subpaths.map(({ label, subpath, key }) => [label, subpath, key]),
    [
      ['Smtp (./smtp) on top of the Node entry', './src/smtp/index.js', './smtp'],
      ['Mime (./mime) on top of the Node entry', './src/mime/index.js', './mime'],
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
    extras.map(({ gzip, min, raw, key }) => [gzip, min, raw, key]),
    [
      [400, 800, 1200, './smtp'],
      [70, 140, 210, './mime'],
    ],
  );
});

test('Scripts: every entry of the exports map has a size budget, and only those', () => {
  const { budgetProblems } = require('../../scripts/size.js');
  assert.deepStrictEqual(
    budgetProblems(require('../../scripts/size-budgets.json'), pkg.exports),
    [],
  );
  const exportsMap = { '.': {}, './smtp': {}, './mime': {} };
  assert.deepStrictEqual(budgetProblems({ '.': 8, './smtp': 0, './jmap': 1 }, exportsMap), [
    './mime has no budget',
    './smtp needs a budget of a positive number of kilobytes',
    './jmap has a budget but is not in the exports map',
  ]);
  assert.deepStrictEqual(
    budgetProblems({ '.': '8', './smtp': 1, './mime': Infinity }, exportsMap),
    [
      '. needs a budget of a positive number of kilobytes',
      './mime needs a budget of a positive number of kilobytes',
    ],
  );
});

test('Scripts: size reports the entries and, with --check, enforces their budgets', (t) => {
  const { SUBPATHS } = require('../../scripts/size.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-size-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (name, budgets) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, JSON.stringify(budgets));
    return file;
  };
  const everyEntry = (limit) => {
    const budgets = {};
    for (const key of Object.keys(pkg.exports)) budgets[key] = limit;
    return budgets;
  };

  const ok = run('scripts/size.js', ['--check', '--budgets', write('ok.json', everyEntry(100))]);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /\| Node entry \(index\.js\) \|/);
  for (const { label } of SUBPATHS) assert.ok(ok.stdout.includes(`| ${label} |`), label);

  // Without --check the budgets are not read.
  const report = run('scripts/size.js', ['--budgets', path.join(directory, 'none.json')]);
  assert.strictEqual(report.status, 0, report.stderr);

  const over = run('scripts/size.js', [
    '--check',
    '--budgets',
    write('over.json', everyEntry(0.001)),
  ]);
  assert.strictEqual(over.status, 1);
  assert.match(over.stderr, /Bundle budget exceeded: Node entry/);
  for (const { label } of SUBPATHS) {
    assert.ok(over.stderr.includes(`Bundle budget exceeded: ${label}`), label);
  }

  const { './smtp': smtp, ...missing } = everyEntry(100);
  const unbudgeted = run('scripts/size.js', [
    '--check',
    '--budgets',
    write('missing.json', missing),
  ]);
  assert.strictEqual(unbudgeted.status, 1);
  assert.match(unbudgeted.stderr, /missing\.json: \.\/smtp has no budget/);
  assert.strictEqual(unbudgeted.stdout, '');
});

test('Scripts: check-dts compiles the types of every entry of the exports map', () => {
  const { typesOf } = require('../../scripts/check-dts.js');
  assert.deepStrictEqual(
    typesOf(pkg.exports),
    Object.values(pkg.exports).map((entry) => entry.types),
  );
  assert.strictEqual(typesOf(pkg.exports)[0], './index.d.ts');
});
