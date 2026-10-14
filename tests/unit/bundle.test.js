const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const pkg = require('../../package.json');

const ROOT = path.join(__dirname, '../..');

// Loads an entry point the way a consumer's bundler would (a serverless
// function, a single-file deploy), minified and not: the shipped files must
// work after bundling, not only when required from source.
const loadNode = async (entry, minify) => {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    write: false,
    logLevel: 'silent',
    platform: 'node',
    format: 'cjs',
    minify,
  });
  const module = { exports: {} };
  const load = vm.compileFunction(result.outputFiles[0].text, ['module', 'exports', 'require']);
  load(module, module.exports, require);
  return module.exports;
};

for (const minify of [false, true]) {
  const label = minify ? 'minified' : 'unminified';
  test(`Bundle: node entry, ${label}`, async () => {
    const { createMailer } = await loadNode('index.js', minify);
    assert.strictEqual(typeof createMailer, 'function');
    assert.throws(() => createMailer({}), { message: 'createMailer is not implemented yet' });
  });

  // Every entry of the exports map bundles on its own and keeps the names and
  // the kinds of its exports: a require the bundler cannot follow, or a module
  // that fails while it loads, shows up here.
  for (const { default: file } of Object.values(pkg.exports)) {
    test(`Bundle: ${file}, ${label}`, async () => {
      const bundled = await loadNode(file, minify);
      const source = require(path.join(ROOT, file));
      assert.deepStrictEqual(Object.keys(bundled), Object.keys(source));
      for (const name of Object.keys(source)) {
        assert.strictEqual(typeof bundled[name], typeof source[name], name);
      }
    });
  }
}
