/**
 * Bundle-size report, run with `pnpm size`. With `--max-gzip <KB>` it also fails
 * when the entry exceeds that min+gzip budget (CI uses it as a gate).
 *
 * Bundles the shipped entry point with esbuild the way a consumer's bundler
 * would (a serverless function, a single-file deploy), then reports:
 *   - raw:      bundled, un-minified
 *   - min:      fully minified (whitespace + identifier mangling + syntax)
 *   - min+gzip: the number that matters for cold-start budgets
 *
 * The package has no runtime dependencies, so a third-party module required
 * from src/ by mistake would be bundled in (devDependencies are installed)
 * and show up here as a jump over the budget, besides failing
 * tests/unit/dependencies.test.js.
 */

const { gzipSync } = require('node:zlib');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');

const ENTRIES = [{ label: 'Node entry (index.js)', entry: 'index.js', platform: 'node' }];

const bundle = async (entry, platform, minify) => {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    minify,
    platform,
    write: false,
    logLevel: 'silent',
  });
  return Buffer.from(result.outputFiles[0].contents);
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const budget = () => {
  const args = process.argv.slice(2);
  const index = args.indexOf('--max-gzip');
  if (index === -1) return null;
  const limit = Number(args[index + 1]);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('--max-gzip needs a positive number of kilobytes');
  }
  return limit * 1024;
};

const main = async () => {
  const maxGzip = budget();
  const rows = [];
  for (const { label, entry, platform } of ENTRIES) {
    const raw = await bundle(entry, platform, false);
    const min = await bundle(entry, platform, true);
    const gzip = gzipSync(min, { level: 9 });
    rows.push({ label, raw: raw.length, min: min.length, gzip: gzip.length });
  }
  console.log('| Entry | raw | min | min+gzip |');
  console.log('| ----- | ---:| ---:| --------:|');
  for (const row of rows) {
    console.log(`| ${row.label} | ${kb(row.raw)} | ${kb(row.min)} | ${kb(row.gzip)} |`);
  }
  if (maxGzip === null) return;
  const over = rows.filter((row) => row.gzip > maxGzip);
  for (const row of over) {
    console.error(
      `Bundle budget exceeded: ${row.label} is ${kb(row.gzip)} min+gzip, max ${kb(maxGzip)}`,
    );
  }
  if (over.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
