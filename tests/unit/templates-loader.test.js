// Not ported: tests of the loaders of ./templates, on a directory of their
// own under the system's temporary directory.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createFileLoader,
  createMemoryLoader,
  createTemplateRenderer,
  createEjsEngine,
} = require('../../src/templates/index.js');
const ejs = require('ejs');

const makeTree = (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-templates-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'emails');
  fs.mkdirSync(path.join(root, 'auth'), { recursive: true });
  fs.mkdirSync(path.join(root, 'folder.ejs'));
  fs.writeFileSync(path.join(root, 'welcome.ejs'), '﻿<p>Hi <%= name %></p>');
  fs.writeFileSync(path.join(root, 'auth', 'reset.ejs'), '<p>reset</p>');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'not a template');
  fs.writeFileSync(path.join(root, 'big.ejs'), 'x'.repeat(2048));
  fs.writeFileSync(path.join(base, 'secret.ejs'), 'secret');
  return { base, root };
};

test('Templates: the file loader reads a name under its directory, its BOM dropped', async (t) => {
  const { root } = makeTree(t);
  const loader = createFileLoader({ dir: root, extensions: ['.ejs'], maxBytes: 1024 });
  const welcome = await loader.load('welcome.ejs');
  assert.strictEqual(welcome.name, 'welcome.ejs');
  assert.strictEqual(welcome.source, '<p>Hi <%= name %></p>');
  assert.strictEqual(welcome.path, fs.realpathSync(path.join(root, 'welcome.ejs')));
  assert.strictEqual((await loader.load('auth/reset.ejs')).source, '<p>reset</p>');
  assert.strictEqual(loader.loadSync('auth/reset.ejs').source, '<p>reset</p>');
  // Missing, a directory, another extension and a name that is not one: none.
  for (const name of [
    'missing.ejs',
    'folder.ejs',
    'notes.txt',
    '../secret.ejs',
    'auth/../welcome.ejs',
    '/etc/passwd',
  ]) {
    assert.strictEqual(await loader.load(name), undefined, name);
    assert.strictEqual(loader.loadSync(name), undefined, name);
  }
  assert.strictEqual(await loader.load('welcome.ejs/x.ejs'), undefined);
  assert.strictEqual(loader.loadSync('welcome.ejs/x.ejs'), undefined);
  // Over maxBytes.
  await assert.rejects(loader.load('big.ejs'), /more than 1024 bytes/);
  assert.throws(() => loader.loadSync('big.ejs'), /more than 1024 bytes/);
  // Any extension by default.
  assert.strictEqual(
    (await createFileLoader({ dir: root }).load('notes.txt')).source,
    'not a template',
  );
});

test('Templates: the file loader follows no symbolic link out of its directory', async (t) => {
  if (process.platform === 'win32') {
    t.skip('symbolic links need privileges on Windows');
    return;
  }
  const { base, root } = makeTree(t);
  fs.symlinkSync(path.join(base, 'secret.ejs'), path.join(root, 'link.ejs'));
  fs.symlinkSync(path.join(root, 'welcome.ejs'), path.join(root, 'inside.ejs'));
  const loader = createFileLoader({ dir: root });
  await assert.rejects(loader.load('link.ejs'), /leads out of/);
  assert.throws(() => loader.loadSync('link.ejs'), /leads out of/);
  assert.strictEqual((await loader.load('inside.ejs')).source, '<p>Hi <%= name %></p>');
  // A directory reached through a link is its real path.
  const linked = path.join(base, 'linked');
  fs.symlinkSync(root, linked);
  assert.strictEqual(
    (await createFileLoader({ dir: linked }).load('welcome.ejs')).name,
    'welcome.ejs',
  );
});

test('Templates: the file loader surfaces what is not a missing file', async (t) => {
  const { root } = makeTree(t);
  const missingRoot = createFileLoader({ dir: path.join(root, 'nope') });
  await assert.rejects(missingRoot.load('welcome.ejs'), { code: 'ENOENT' });
  assert.throws(() => missingRoot.loadSync('welcome.ejs'), { code: 'ENOENT' });
  // A loader made before its directory exists reads it once it does.
  const later = path.join(root, 'later');
  const early = createFileLoader({ dir: later });
  fs.mkdirSync(later);
  fs.writeFileSync(path.join(later, 'a.ejs'), 'a');
  assert.strictEqual((await early.load('a.ejs')).source, 'a');
  if (process.platform !== 'win32') {
    const loop = path.join(root, 'loop.ejs');
    fs.symlinkSync(loop, loop);
    const loader = createFileLoader({ dir: root });
    await assert.rejects(loader.load('loop.ejs'), { code: 'ELOOP' });
    assert.throws(() => loader.loadSync('loop.ejs'), { code: 'ELOOP' });
  }
});

test('Templates: the loaders check their options', () => {
  assert.throws(() => createFileLoader(), /needs dir/);
  assert.throws(() => createFileLoader({ dir: '' }), /needs dir/);
  assert.throws(() => createFileLoader({ dir: 'x', extensions: '.ejs' }), /must be an array/);
  assert.throws(() => createFileLoader({ dir: 'x', extensions: ['ejs'] }), /with their dot/);
  assert.throws(() => createFileLoader({ dir: 'x', maxBytes: 0 }), /maxBytes/);
  assert.throws(() => createMemoryLoader(), /needs the templates/);
  assert.throws(() => createMemoryLoader([]), /needs the templates/);
  assert.throws(() => createMemoryLoader({ '../x': 'a' }), /template name/);
  const memory = createMemoryLoader({ a: '<p/>', 'b/c': { component: true } });
  assert.deepStrictEqual(memory.load('a'), { name: 'a', source: '<p/>' });
  assert.deepStrictEqual(memory.loadSync('b/c'), { name: 'b/c', source: { component: true } });
  assert.strictEqual(memory.load('z'), undefined);
});

test('Templates: a renderer over the file loader renders from disk', async (t) => {
  const { root } = makeTree(t);
  const renderer = createTemplateRenderer({
    engine: createEjsEngine({ ejs }),
    loader: createFileLoader({ dir: root, extensions: ['.ejs'] }),
  });
  const output = await renderer.render({ template: 'welcome', context: { name: 'Ada' } });
  assert.deepStrictEqual(output, {
    template: 'welcome.ejs',
    html: '<p>Hi Ada</p>',
    text: 'Hi Ada',
  });
});
