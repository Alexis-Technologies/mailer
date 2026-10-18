// Not ported: every entry of the exports map, required and imported by name on
// the runtime that runs the test (Node, Bun or Deno), as a consumer would.
const { test } = require('node:test');
const assert = require('node:assert');
const pkg = require('../../package.json');

for (const subpath of Object.keys(pkg.exports)) {
  const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;

  test(`Runtime: ${specifier} is required, and imported by name from ESM`, async () => {
    const required = require(specifier);
    const imported = await import(specifier);
    const names = Object.keys(required);
    assert.ok(names.length > 0, `${specifier} exports nothing`);
    for (const name of names) {
      assert.notStrictEqual(imported[name], undefined, `${specifier} has no ESM export ${name}`);
      assert.strictEqual(imported[name], required[name], name);
    }
    assert.strictEqual(imported.default, required);
  });
}
