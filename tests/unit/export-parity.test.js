const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../../package.json');

const ROOT = path.join(__dirname, '../..');

// The d.ts files are written by hand: every runtime export must be declared
// in them, and every declared value export must exist at runtime.
// `export type` and `export interface` have no runtime counterpart and are
// not compared.
const declaredValueExports = (dtsFile) => {
  const source = fs.readFileSync(path.join(ROOT, dtsFile), 'utf8');
  const pattern = /^export (?:declare )?(?:abstract )?(?:class|function|const|let|var) ([\w$]+)/gm;
  const names = new Set();
  for (const match of source.matchAll(pattern)) names.add(match[1]);
  return names;
};

// Every entry of the closed exports map, `.` and each subpath: what a
// consumer imports, so a subpath is checked as soon as it is declared.
const entryPoints = Object.entries(pkg.exports).map(([subpath, { types, default: file }]) => ({
  specifier: subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`,
  runtimeFile: file,
  dtsFile: types,
}));

test('Exports: the exports map lists types first, then default', () => {
  assert.ok(entryPoints.length > 0);
  for (const entry of Object.values(pkg.exports)) {
    assert.deepStrictEqual(Object.keys(entry), ['types', 'default']);
  }
});

for (const { specifier, runtimeFile, dtsFile } of entryPoints) {
  test(`Exports: ${runtimeFile} matches ${dtsFile}`, () => {
    const runtime = new Set(Object.keys(require(path.join(ROOT, runtimeFile))));
    const declared = declaredValueExports(dtsFile);
    const undeclared = [...runtime].filter((name) => !declared.has(name)).sort();
    const phantom = [...declared].filter((name) => !runtime.has(name)).sort();
    assert.ok(runtime.size > 0, `${runtimeFile} exports nothing`);
    assert.deepStrictEqual(undeclared, [], `missing from ${dtsFile}`);
    assert.deepStrictEqual(phantom, [], `absent from ${runtimeFile} at runtime`);
  });

  test(`Exports: ${specifier} resolves to ${runtimeFile} and imports by name from ESM`, () => {
    assert.strictEqual(require(specifier), require(path.join(ROOT, runtimeFile)));
    const names = [...declaredValueExports(dtsFile)].sort();
    const source = [
      `import { ${names.join(', ')} } from '${specifier}';`,
      `const values = { ${names.join(', ')} };`,
      'const missing = Object.keys(values).filter((name) => values[name] === undefined);',
      'process.stdout.write(JSON.stringify(missing));',
    ].join('\n');
    const args = ['--input-type=module', '-e', source];
    const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(output), []);
  });
}

// tsc compiles the d.ts files of check:dts together, so a lib referenced by
// one of them hides a missing reference in another; a consumer may import a
// single subpath.
test('Exports: a d.ts that uses AsyncDisposable references esnext.disposable itself', () => {
  for (const { dtsFile } of entryPoints) {
    const source = fs.readFileSync(path.join(ROOT, dtsFile), 'utf8');
    if (/AsyncDisposable|Symbol\.asyncDispose/.test(source)) {
      assert.match(source, /^\/\/\/ <reference lib="esnext\.disposable" \/>$/m, dtsFile);
    }
  }
});
