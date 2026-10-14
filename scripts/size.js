/**
 * Bundle-size report, run with `pnpm size`. With `--max-gzip <KB>` it also fails
 * when the root entry exceeds that min+gzip budget, and with
 * `--max-gzip-<subpath> <KB>` when a subpath of the exports map adds more than
 * that on top of the root entry (`--max-gzip-smtp` for `./smtp`). CI passes one
 * flag per subpath as a gate.
 *
 * Bundles the shipped entry points with esbuild the way a consumer's bundler
 * would (a serverless function, a single-file deploy), then reports:
 *   - raw:      bundled, un-minified
 *   - min:      fully minified (whitespace + identifier mangling + syntax)
 *   - min+gzip: the number that matters for cold-start budgets
 *
 * The subpaths require the core of the root entry (Message, Receipt), so on
 * their own they would bundle it again; each is measured as the difference
 * between a bundle of the root entry plus the subpath and the root entry
 * alone, which is what a consumer that imports both pays for it. A subpath
 * that requires another one (./smtp requires ./mime) is charged for it.
 *
 * The package has no runtime dependencies, so a third-party module required
 * from src/ by mistake would be bundled in (devDependencies are installed)
 * and show up here as a jump over the budget, besides failing
 * tests/unit/dependencies.test.js.
 */

const { gzipSync } = require('node:zlib');
const path = require('node:path');
const esbuild = require('esbuild');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');

const ENTRY = { label: 'Node entry (index.js)', entry: 'index.js', platform: 'node' };

// One row per subpath of the exports map.
const subpathsOf = (exportsMap) =>
  Object.entries(exportsMap)
    .filter(([subpath]) => subpath !== '.')
    .map(([subpath, { default: file }]) => {
      const name = subpath.slice(2);
      return {
        label: `${name[0].toUpperCase()}${name.slice(1)} (${subpath}) on top of the Node entry`,
        entry: ENTRY.entry,
        platform: ENTRY.platform,
        subpath: file,
        flag: `--max-gzip-${name}`,
      };
    });

const SUBPATHS = subpathsOf(pkg.exports);

// `entry` alone, or `entry` plus subpaths in one bundle, exported so that
// the bundle keeps them: the package says `sideEffects: false`, and esbuild
// drops a require whose result nothing uses.
const bundle = async (entry, platform, minify, subpaths = []) => {
  let extra = '';
  for (const subpath of subpaths) extra += `, require('${subpath}')`;
  const contents = `module.exports = [require('./${entry}')${extra}];`;
  const result = await esbuild.build({
    stdin: { contents, resolveDir: ROOT },
    bundle: true,
    minify,
    platform,
    write: false,
    logLevel: 'silent',
  });
  return Buffer.from(result.outputFiles[0].contents);
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const budget = (flag) => {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const limit = Number(args[index + 1]);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`${flag} needs a positive number of kilobytes`);
  }
  return limit * 1024;
};

const measure = async ({ label, entry, platform }, subpaths) => {
  const raw = await bundle(entry, platform, false, subpaths);
  const min = await bundle(entry, platform, true, subpaths);
  const gzip = gzipSync(min, { level: 9 });
  return { label, raw: raw.length, min: min.length, gzip: gzip.length };
};

const exceeded = (row, max) => {
  console.error(`Bundle budget exceeded: ${row.label} is ${kb(row.gzip)} min+gzip, max ${kb(max)}`);
  process.exitCode = 1;
};

// The rows of the subpaths: each measured as the difference between the root
// entry plus the subpath and the root entry alone. `size` and `subpaths` are
// parameters so that the arithmetic is tested without esbuild.
const extrasOf = async (core, size = measure, subpaths = SUBPATHS) => {
  const extras = [];
  for (const entry of subpaths) {
    const both = await size(entry, [entry.subpath]);
    extras.push({
      label: entry.label,
      max: budget(entry.flag),
      raw: both.raw - core.raw,
      min: both.min - core.min,
      gzip: both.gzip - core.gzip,
    });
  }
  return extras;
};

const main = async () => {
  const maxGzip = budget('--max-gzip');
  const core = await measure(ENTRY);
  const extras = await extrasOf(core);
  console.log('| Entry | raw | min | min+gzip |');
  console.log('| ----- | ---:| ---:| --------:|');
  for (const row of [core, ...extras]) {
    console.log(`| ${row.label} | ${kb(row.raw)} | ${kb(row.min)} | ${kb(row.gzip)} |`);
  }
  if (maxGzip !== null && core.gzip > maxGzip) exceeded(core, maxGzip);
  for (const row of extras) {
    if (row.max !== null && row.gzip > row.max) exceeded(row, row.max);
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { SUBPATHS, subpathsOf, extrasOf };
