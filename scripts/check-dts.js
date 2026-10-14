/**
 * Compiles the hand-written type surface on its own, run with
 * `pnpm run check:dts`: index.d.ts and the d.ts of every subpath of the
 * exports map, under `--strict` and without `skipLibCheck`. There is no
 * tsconfig, hence the explicit target; the d.ts files that need newer library
 * types (`AsyncDisposable`) reference them with `/// <reference lib>`.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');

const typesOf = (exportsMap) => Object.values(exportsMap).map((entry) => entry.types);

const main = () => {
  const tsc = path.join(ROOT, 'node_modules/typescript/bin/tsc');
  const args = ['--noEmit', '--strict', '--target', 'es2022', '--skipLibCheck', 'false'];
  const result = spawnSync(process.execPath, [tsc, ...args, ...typesOf(pkg.exports)], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
};

if (require.main === module) main();

module.exports = { typesOf };
