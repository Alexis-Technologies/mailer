const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

const listFiles = (dir) => {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
};

// The mailer has no runtime dependencies: its own transports are built on
// node:* modules and the global fetch, and a driver of the infrastructure
// (a queue, a database) is passed in by the application, never required.
test('Dependencies: package.json declares no runtime or peer dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.dependencies, undefined);
  assert.strictEqual(pkg.peerDependencies, undefined);
  assert.strictEqual(pkg.optionalDependencies, undefined);
});

test('Dependencies: src/ requires only node: builtins and relative .js files', () => {
  const offenders = [];
  let checked = 0;
  const pattern = /require\(\s*(['"])(.*?)\1\s*\)/g;
  for (const file of listFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, , specifier] of source.matchAll(pattern)) {
      checked++;
      const builtin = specifier.startsWith('node:');
      const relative = /^\.\.?\//.test(specifier) && specifier.endsWith('.js');
      if (!builtin && !relative) offenders.push(`${path.relative(SRC, file)}: ${specifier}`);
    }
  }
  assert.ok(checked > 0, 'no require() found under src/');
  assert.deepStrictEqual(offenders, []);
});
