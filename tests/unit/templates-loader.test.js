// Not ported: tests of the loaders of ./templates, on a directory of their
// own under the system's temporary directory.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createFileLoader,
  createMemoryLoader,
  createTemplateRenderer,
  createEjsEngine,
} = require('../../src/templates/index.js');
const ejs = require('ejs');

// Replaces functions of node:fs for a test, and tells whether it could: a
// runtime whose node:fs is not writable leaves the test to the others.
const replace = (t, pairs) => {
  for (const [object, name, implementation] of pairs) {
    const before = object[name];
    try {
      t.mock.method(object, name, implementation);
    } catch {
      return false;
    }
    if (object[name] === before) return false;
  }
  return true;
};

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
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
  return { base, root };
};

test('Templates: the file loader reads a name under its directory, its BOM dropped', async (t) => {
  const { root } = makeTree(t);
  const loader = createFileLoader({ dir: root, extensions: ['.ejs'], maxBytes: 1024 });
  const welcome = await loader.load('welcome.ejs');
  assert.strictEqual(welcome.name, 'welcome.ejs');
  assert.strictEqual(welcome.source, '<p>Hi <%= name %></p>');
  assert.strictEqual(welcome.path, fs.realpathSync.native(path.join(root, 'welcome.ejs')));
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
    // Before: read, as a segment after the first could start with a dot.
    'auth/../.env',
    'auth/.hidden.ejs',
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

test('Templates: the file loader reads one real path, sync or not, however its directory is spelled', async (t) => {
  // Before: loadSync resolved with the realpath of JavaScript, which keeps
  // the case it is given and the short names of Windows (the temporary
  // directory of a runner), and load with the system's, so a load after a
  // loadSync was refused as leading out of the directory.
  const { root } = makeTree(t);
  const spelled = root.replace('mailer-templates-', 'MAILER-TEMPLATES-');
  if (!fs.existsSync(spelled)) {
    t.skip('the file system tells case apart');
    return;
  }
  const real = fs.realpathSync.native(path.join(root, 'welcome.ejs'));
  const syncFirst = createFileLoader({ dir: spelled });
  assert.strictEqual(syncFirst.loadSync('welcome.ejs').path, real);
  assert.strictEqual((await syncFirst.load('welcome.ejs')).path, real);
  const asyncFirst = createFileLoader({ dir: spelled });
  assert.strictEqual((await asyncFirst.load('welcome.ejs')).path, real);
  assert.strictEqual(asyncFirst.loadSync('welcome.ejs').path, real);
});

test('Templates: the file loader reads no more than maxBytes of a file that grew since its size', async (t) => {
  // Before: the size was taken by path and the file read whole by path
  // after, so a file that grew in between, or was replaced, was read whole.
  const { root } = makeTree(t);
  const small = { isFile: () => true, size: 10 };
  const open = fsp.open;
  const replaced = replace(t, [
    [fsp, 'stat', async () => small],
    [fs, 'statSync', () => small],
    [
      fsp,
      'open',
      async (...args) => {
        const handle = await open(...args);
        handle.stat = async () => small;
        return handle;
      },
    ],
    [fs, 'fstatSync', () => small],
  ]);
  if (!replaced) {
    t.skip('node:fs cannot be replaced on this runtime');
    return;
  }
  const loader = createFileLoader({ dir: root, maxBytes: 1024 });
  await assert.rejects(loader.load('big.ejs'), /more than 1024 bytes/);
  assert.throws(() => loader.loadSync('big.ejs'), /more than 1024 bytes/);
  // A file that grew within maxBytes is read whole, through the descriptor.
  assert.strictEqual((await createFileLoader({ dir: root }).load('big.ejs')).source.length, 2048);
  assert.strictEqual(createFileLoader({ dir: root }).loadSync('big.ejs').source.length, 2048);
});

test('Templates: the file loader stops at the abort of its signal', async (t) => {
  const { root } = makeTree(t);
  const loader = createFileLoader({ dir: root });
  const reason = new Error('stop');
  await assert.rejects(
    loader.load('welcome.ejs', { signal: AbortSignal.abort(reason) }),
    (e) => e === reason,
  );
  // Aborted after it found the file, before it opens it.
  const controller = new AbortController();
  const realpath = fsp.realpath;
  const replaced = replace(t, [
    [
      fsp,
      'realpath',
      async (...args) => {
        const real = await realpath(...args);
        if (args[0].endsWith('welcome.ejs')) controller.abort(reason);
        return real;
      },
    ],
  ]);
  if (!replaced) {
    t.skip('node:fs cannot be replaced on this runtime');
    return;
  }
  await assert.rejects(
    loader.load('welcome.ejs', { signal: controller.signal }),
    (e) => e === reason,
  );
  assert.strictEqual((await loader.load('welcome.ejs', {})).source, '<p>Hi <%= name %></p>');
});

test('Templates: the file loader takes a directory it cannot open for none', async (t) => {
  // Windows opens no directory: EISDIR, where the others open it and say it
  // is no file.
  const { root } = makeTree(t);
  const denied = (code) => Object.assign(new Error(code), { code });
  let code = 'EISDIR';
  const replaced = replace(t, [
    [
      fsp,
      'open',
      async () => {
        throw denied(code);
      },
    ],
    [
      fs,
      'openSync',
      () => {
        throw denied(code);
      },
    ],
  ]);
  if (!replaced) {
    t.skip('node:fs cannot be replaced on this runtime');
    return;
  }
  const loader = createFileLoader({ dir: root });
  assert.strictEqual(await loader.load('folder.ejs'), undefined);
  assert.strictEqual(loader.loadSync('folder.ejs'), undefined);
  code = 'EACCES';
  await assert.rejects(loader.load('welcome.ejs'), { code: 'EACCES' });
  assert.throws(() => loader.loadSync('welcome.ejs'), { code: 'EACCES' });
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
  assert.throws(() => createFileLoader({ dir: 'x', extensions: ['ejs'] }), /starts with its dot/);
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
