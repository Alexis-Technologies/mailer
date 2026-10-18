// Every file the package ships says where it comes from: the attribution header
// of the project it is a port of (upyo for most of the transport; nodemailer,
// unemail and sently for the features of 1.1; the notices are in LICENSE), or
// that it is not ported (CLAUDE.md, "Code ported from upyo" and "Code ported
// from nodemailer, unemail and sently").
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

// The path a header names: a source file, or for a d.ts, whose types come from
// several files, a directory.
const UPYO_FILE = 'packages\\/[a-z-]+\\/src\\/[\\w./-]+\\.ts';
const UPYO_TYPES = 'packages\\/[a-z-]+\\/src(?:\\/[\\w./-]+)?';
const SRC_FILE = 'src\\/[\\w./-]+\\.ts';
const SRC_TYPES = 'src(?:\\/[\\w./-]+)?';

const SOURCES = [
  {
    name: 'upyo',
    version: '0.7.0',
    notice: '// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee',
    license: /derived from Upyo \(https:\/\/github\.com\/dahlia\/upyo\)[\s\S]*?2025 Hong Minhee/,
    file: UPYO_FILE,
    types: UPYO_TYPES,
  },
  {
    name: 'nodemailer',
    version: '10.0.16',
    notice:
      '// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman',
    license:
      /derived from Nodemailer\s+\(https:\/\/github\.com\/nodemailer\/nodemailer\), version 10\.0\.16[\s\S]*?2011-2023 Andris Reinman/,
    file: SRC_FILE,
    types: SRC_TYPES,
  },
  {
    name: 'unemail',
    version: '0.7.0',
    notice: '// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind',
    license:
      /derived from unemail\s+\(https:\/\/github\.com\/productdevbook\/unemail\), version 0\.7\.0[\s\S]*?2025 Wind/,
    file: SRC_FILE,
    types: SRC_TYPES,
  },
  {
    name: 'sently',
    version: '1.2.2',
    notice: '// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors',
    license:
      /derived from sently\s+\(https:\/\/github\.com\/omqkhafi\/sently\), version 1\.2\.2[\s\S]*?2026 sendx contributors/,
    file: SRC_FILE,
    types: SRC_TYPES,
  },
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The header lines that name a source: the first line of a port (`Ported
// from`, or `Types ported from` in a d.ts), and `Also ported from` for a
// second source further down.
const patternsOf = (source) => {
  const prefix = `${source.name} v${escape(source.version)} \\(`;
  return {
    ported: new RegExp(`^\\/\\/ Ported from ${prefix}${source.file}[),]`),
    types: new RegExp(`^\\/\\/ Types ported from ${prefix}${source.types}[),]`),
    also: new RegExp(`^\\/\\/ Also ported from ${prefix}(?:${source.file}|${source.types})[),]`),
  };
};

const PATTERNS = SOURCES.map((source) => ({ source, ...patternsOf(source) }));
const NOT_PORTED = '// Not ported: ';

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
  const first = file.endsWith('.d.ts') ? 'types' : 'ported';
  const named = PATTERNS.filter(
    (pattern) =>
      pattern[first].test(header[0]) || header.slice(1).some((line) => pattern.also.test(line)),
  );
  if (!PATTERNS.some((pattern) => pattern[first].test(header[0]))) {
    return `${file} starts with neither a ported header nor "${NOT_PORTED.trim()}"`;
  }
  for (const { source } of named) {
    if (!header.includes(source.notice)) {
      return `${file} has the ${source.name} header without its notice`;
    }
  }
  return undefined;
};

test('Attribution: every shipped file has a ported header or says it is not ported', () => {
  // The root index.js is a one-line shim over src/index.js.
  const problems = [];
  for (const file of shippedFiles()) {
    const problem = problemOf(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
    if (problem !== undefined) problems.push(problem);
  }
  assert.deepStrictEqual(problems, []);
});

test('Attribution: the check refuses a file without a header or without the notice', () => {
  const upyo = SOURCES[0];
  const notice = `${upyo.notice}\n`;
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
  // The marker of upyo's port alone is no longer enough.
  assert.match(
    problemOf('src/a.js', '// Not ported from upyo: a helper.\n'),
    /starts with neither/,
  );
});

test('Attribution: every source has its own header, version and notice', () => {
  const nodemailer = '// Ported from nodemailer v10.0.16 (src/sendmail-transport/index.ts)\n';
  const unemail = '// Ported from unemail v0.7.0 (src/middleware/rate-limit.ts)\n';
  const sently = '// Ported from sently v1.2.2 (src/webhooks/resend.ts)\n';
  const [, nodemailerSource, unemailSource, sentlySource] = SOURCES;
  assert.strictEqual(
    problemOf('src/a.js', `${nodemailer}${nodemailerSource.notice}\ncode`),
    undefined,
  );
  assert.strictEqual(problemOf('src/a.js', `${unemail}${unemailSource.notice}\n`), undefined);
  assert.strictEqual(problemOf('src/a.js', `${sently}${sentlySource.notice}\n`), undefined);
  assert.strictEqual(
    problemOf(
      'src/a.d.ts',
      `// Types ported from unemail v0.7.0 (src/drivers)\n${unemailSource.notice}\n`,
    ),
    undefined,
  );
  // Another version, or another source's notice, is refused.
  assert.match(
    problemOf('src/a.js', `// Ported from unemail v0.6.0 (src/a.ts)\n${unemailSource.notice}\n`),
    /starts with neither/,
  );
  assert.strictEqual(
    problemOf('src/a.js', `${unemail}${sentlySource.notice}\n`),
    'src/a.js has the unemail header without its notice',
  );
});

test('Attribution: a second source needs its own notice', () => {
  const [, , unemail, sently] = SOURCES;
  const header = [
    '// Ported from unemail v0.7.0 (src/drivers/postmark.ts)',
    unemail.notice,
    '// Also ported from sently v1.2.2 (src/transports/postmark.ts)',
  ];
  assert.strictEqual(
    problemOf('src/a.js', `${header.join('\n')}\n${sently.notice}\ncode`),
    undefined,
  );
  assert.strictEqual(
    problemOf('src/a.js', `${header.join('\n')}\ncode`),
    'src/a.js has the sently header without its notice',
  );
});

test('Attribution: LICENSE carries the notice of every source', () => {
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  for (const source of SOURCES) assert.match(license, source.license, source.name);
});
