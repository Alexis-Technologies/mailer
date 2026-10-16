// Every file the package ships says where it comes from: the attribution header
// of upyo, whose code most of the transport is a port of (MIT, the notice is in
// LICENSE), or that it is not ported (CLAUDE.md, "Code ported from upyo").
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const NOTICE = '// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee';
const PORTED = /^\/\/ Ported from upyo v0\.7\.0 \(packages\/[a-z-]+\/src\/[\w./-]+\.ts[),]/;
const PORTED_TYPES = /^\/\/ Types ported from upyo v0\.7\.0 \(packages\/[a-z-]+\/src[/)]/;
const NOT_PORTED = '// Not ported from upyo: ';

const shippedFiles = () => {
  const files = ['index.d.ts'];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (relative.endsWith('.js') || relative.endsWith('.d.ts')) files.push(relative);
    }
  };
  walk('src');
  return files;
};

// The comment lines a file starts with.
const headerOf = (text) => {
  const lines = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('//')) break;
    lines.push(line);
  }
  return lines;
};

const problemOf = (file, text) => {
  const header = headerOf(text);
  if (header.length === 0) return `${file} has no header`;
  if (header[0].startsWith(NOT_PORTED)) return undefined;
  const pattern = file.endsWith('.d.ts') ? PORTED_TYPES : PORTED;
  if (!pattern.test(header[0])) {
    return `${file} starts with neither the upyo header nor "${NOT_PORTED.trim()}"`;
  }
  if (!header.includes(NOTICE)) return `${file} has the upyo header without its notice`;
  return undefined;
};

test('Attribution: every shipped file has the upyo header or says it is not ported', () => {
  // The root index.js is a one-line shim over src/index.js.
  const problems = [];
  for (const file of shippedFiles()) {
    const problem = problemOf(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
    if (problem !== undefined) problems.push(problem);
  }
  assert.deepStrictEqual(problems, []);
});

test('Attribution: the check refuses a file without a header or without the notice', () => {
  const notice = `${NOTICE}\n`;
  const ported = '// Ported from upyo v0.7.0 (packages/smtp/src/smtp-connection.ts)\n';
  assert.strictEqual(problemOf('src/a.js', `${ported}${notice}code`), undefined);
  assert.strictEqual(problemOf('src/a.js', `${NOT_PORTED}a helper.\ncode`), undefined);
  assert.strictEqual(
    problemOf('src/a.d.ts', `// Types ported from upyo v0.7.0 (packages/smtp/src)\n${notice}`),
    undefined,
  );
  assert.strictEqual(problemOf('src/a.js', 'const a = 1;'), 'src/a.js has no header');
  assert.strictEqual(
    problemOf('src/a.js', `${ported}code`),
    'src/a.js has the upyo header without its notice',
  );
  assert.match(problemOf('src/a.js', '// Some code.\ncode'), /starts with neither/);
  assert.match(problemOf('src/a.d.ts', `${ported}${notice}`), /starts with neither/);
});

test('Attribution: LICENSE carries the notice of upyo', () => {
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /derived from Upyo \(https:\/\/github\.com\/dahlia\/upyo\)/);
  assert.match(license, /Copyright 2025 Hong Minhee/);
});
