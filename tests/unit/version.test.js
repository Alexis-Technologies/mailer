const { test } = require('node:test');
const assert = require('node:assert');
const pkg = require('../../package.json');
const version = require('../../src/version.js');

test('Version: src/version.js matches package.json', () => {
  assert.deepStrictEqual(version, { name: pkg.name, version: pkg.version });
});
