const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '../..');

// Loads the entry point the way a consumer's bundler would (a serverless
// function, a single-file deploy), minified and not, and calls the API
// through the result: the shipped files must work after bundling, not only
// when required from source.
const loadNode = async (minify) => {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, 'index.js')],
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
    const { createMailer } = await loadNode(minify);
    assert.strictEqual(typeof createMailer, 'function');
    assert.throws(() => createMailer({}), { message: 'createMailer is not implemented yet' });
  });
}
