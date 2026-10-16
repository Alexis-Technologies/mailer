/**
 * Bundle-size report, run with `pnpm size`. With `--check` it also fails when an
 * entry of the exports map goes over its min+gzip budget in
 * `scripts/size-budgets.json` (in KB, keyed like the exports map: the root
 * entry, and what each subpath adds on top of it), and when an entry has no
 * budget there or a budget names no entry, so that a new subpath is gated from
 * its first commit. `--budgets <file>` reads another file. CI and
 * `prepublishOnly` run `--check`.
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

const fs = require('node:fs');
const { gzipSync } = require('node:zlib');
const path = require('node:path');
const esbuild = require('esbuild');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const BUDGETS = path.join(__dirname, 'size-budgets.json');

const ENTRY = { label: 'Node entry (index.js)', entry: 'index.js', platform: 'node', key: '.' };

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
        key: subpath,
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

// What is wrong with a budgets file for an exports map: an entry without a
// budget, a budget for no entry, or one that is not a positive number of KB.
const budgetProblems = (budgets, exportsMap) => {
  const problems = [];
  for (const key of Object.keys(exportsMap)) {
    if (!Object.hasOwn(budgets, key)) problems.push(`${key} has no budget`);
  }
  for (const [key, limit] of Object.entries(budgets)) {
    if (!Object.hasOwn(exportsMap, key)) {
      problems.push(`${key} has a budget but is not in the exports map`);
    } else if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
      problems.push(`${key} needs a budget of a positive number of kilobytes`);
    }
  }
  return problems;
};

const measure = async ({ label, key, entry, platform }, subpaths) => {
  const raw = await bundle(entry, platform, false, subpaths);
  const min = await bundle(entry, platform, true, subpaths);
  const gzip = gzipSync(min, { level: 9 });
  return { label, key, raw: raw.length, min: min.length, gzip: gzip.length };
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
      key: entry.key,
      raw: both.raw - core.raw,
      min: both.min - core.min,
      gzip: both.gzip - core.gzip,
    });
  }
  return extras;
};

const main = async () => {
  const args = process.argv.slice(2);
  const index = args.indexOf('--budgets');
  const file = index === -1 ? BUDGETS : path.resolve(args[index + 1]);
  const budgets = args.includes('--check') ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (budgets !== null) {
    const problems = budgetProblems(budgets, pkg.exports);
    for (const problem of problems) console.error(`${path.relative(ROOT, file)}: ${problem}`);
    if (problems.length > 0) {
      process.exitCode = 1;
      return;
    }
  }
  const core = await measure(ENTRY);
  const rows = [core, ...(await extrasOf(core))];
  console.log('| Entry | raw | min | min+gzip |');
  console.log('| ----- | ---:| ---:| --------:|');
  for (const row of rows) {
    console.log(`| ${row.label} | ${kb(row.raw)} | ${kb(row.min)} | ${kb(row.gzip)} |`);
  }
  if (budgets === null) return;
  for (const row of rows) {
    const max = budgets[row.key] * 1024;
    if (row.gzip > max) exceeded(row, max);
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { SUBPATHS, budgetProblems, subpathsOf, extrasOf };
