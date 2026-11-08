// The module graph of src/ has no cycles: a module that requires, through
// the requires of what it requires, a module still being loaded would get a
// partial module object. And a program that imports one subpath carries no
// other, except along the edges allowed below.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../../package.json');

const SRC = path.join(__dirname, '../../src');
const REQUIRE = /require\('(\.{1,2}\/[^']+)'\)/g;

const modulesOf = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) modulesOf(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
};

const edgesOf = (file) => {
  const source = fs.readFileSync(file, 'utf8');
  const targets = [];
  for (const match of source.matchAll(REQUIRE)) {
    targets.push(path.resolve(path.dirname(file), match[1]));
  }
  return targets;
};

// POSIX separators on every platform, so the names compare the same on
// Windows, where path.relative joins with a backslash.
const relative = (file) => path.relative(SRC, file).split(path.sep).join('/');

// Every cycle of the graph, as the path that closes it.
const cyclesOf = (graph) => {
  const VISITING = 1;
  const DONE = 2;
  const state = new Map();
  const stack = [];
  const cycles = [];
  const visit = (file) => {
    const seen = state.get(file);
    if (seen === DONE) return;
    if (seen === VISITING) {
      cycles.push([...stack.slice(stack.indexOf(file)), file].map(relative).join(' -> '));
      return;
    }
    state.set(file, VISITING);
    stack.push(file);
    for (const target of graph.get(file)) {
      assert.ok(graph.has(target), `${relative(file)} requires ${target}, not a module of src/`);
      visit(target);
    }
    stack.pop();
    state.set(file, DONE);
  };
  for (const file of graph.keys()) visit(file);
  return cycles;
};

test('Graph: the modules of src/ require each other without a cycle', () => {
  const graph = new Map();
  for (const file of modulesOf(SRC)) graph.set(file, edgesOf(file));
  assert.ok(graph.size > 0);
  assert.deepStrictEqual(cyclesOf(graph), []);
  // The check sees a cycle when there is one.
  const a = path.join(SRC, 'a.js');
  const b = path.join(SRC, 'b.js');
  const looped = new Map([
    [a, [b]],
    [b, [a]],
  ]);
  assert.deepStrictEqual(cyclesOf(looped), ['a.js -> b.js -> a.js']);
});

// The directories of the subpaths, from the exports map: `./smtp` lives in
// src/smtp/, `./webhooks/ses` in src/webhooks/ses/. Everything else
// (src/*.js, src/core/) is the root entry, which requires no subpath, and
// src/internal/ holds private modules any subpath may require, which require
// no subpath either.
const SUBPATHS = Object.keys(pkg.exports)
  .filter((subpath) => subpath !== '.')
  .map((subpath) => path.posix.dirname(pkg.exports[subpath].default).slice('./src/'.length));
// ./smtp renders and signs through the internal modules of ./mime, which
// upstream exported as @upyo/mime/internal.
const SUBPATH_EDGES = [
  'smtp/config.js -> mime/dkim/types.js',
  'smtp/message-converter.js -> mime/message.js',
  'smtp/message-stream.js -> mime/stream.js',
  // The transport checks the DKIM keys when it is made.
  'smtp/smtp-transport.js -> mime/dkim/sign.js',
  'smtp/smtp-transport.js -> mime/dkim/types.js',
  // ./sendmail composes and signs as ./mime does, and checks its DKIM
  // configuration when it is made.
  'sendmail/config.js -> mime/dkim/types.js',
  'sendmail/sendmail-transport.js -> mime/index.js',
  // ./templates derives the text and decodes the text and subject as ./render
  // does, and its React Email engine is the renderer of ./render.
  'templates/renderer.js -> render/html-to-text.js',
  'templates/renderer.js -> render/entities.js',
  'templates/react-email.js -> render/react-email.js',
  // The worker of ./queue renders the subject and content of a template job
  // as ./render does, the text derived from the HTML.
  'queue/handler.js -> render/renderer.js',
  // The audit sink of ./mongodb reads the state of a message as ./audit does.
  'mongodb/audit-sink.js -> audit/states.js',
];

// The subpath of a module: the deepest whose directory holds it.
const subpathOf = (name, subpaths = SUBPATHS) => {
  let found = null;
  for (const subpath of subpaths) {
    if (name.startsWith(`${subpath}/`) && (found === null || subpath.length > found.length)) {
      found = subpath;
    }
  }
  return found;
};

// Whether a require goes from one subpath into another. A subpath nested in
// another (./webhooks/ses in ./webhooks) shares the modules of its parent, as
// the verifier of a provider shares the request layer of the webhooks; the
// parent requires none of its children, and a child none of its siblings.
const crosses = (from, to, subpaths = SUBPATHS) => {
  const source = subpathOf(from, subpaths);
  const destination = subpathOf(to, subpaths);
  if (destination === null || destination === source) return false;
  return source === null || !source.startsWith(`${destination}/`);
};

test('Graph: the root requires no subpath, a subpath another only where allowed', () => {
  const crossings = [];
  for (const file of modulesOf(SRC)) {
    const from = relative(file);
    for (const target of edgesOf(file)) {
      const to = relative(target);
      if (crosses(from, to)) crossings.push(`${from} -> ${to}`);
    }
  }
  assert.deepStrictEqual(crossings.sort(), [...SUBPATH_EDGES].sort());
});

test('Graph: a nested subpath may require its parent; neither the parent nor a sibling it', () => {
  const subpaths = ['webhooks', 'webhooks/ses', 'webhooks/scaleway', 'ses'];
  assert.strictEqual(crosses('webhooks/ses/verifier.js', 'webhooks/request.js', subpaths), false);
  assert.strictEqual(crosses('webhooks/ses/verifier.js', 'internal/http.js', subpaths), false);
  assert.strictEqual(crosses('webhooks/index.js', 'webhooks/ses/index.js', subpaths), true);
  assert.strictEqual(crosses('webhooks/scaleway/a.js', 'webhooks/ses/verifier.js', subpaths), true);
  assert.strictEqual(crosses('webhooks/ses/verifier.js', 'ses/config.js', subpaths), true);
  assert.strictEqual(crosses('core/message.js', 'webhooks/request.js', subpaths), true);
});
