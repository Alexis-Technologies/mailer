/**
 * Checks that every provider of a channel the exports map ships has run live,
 * run by `pnpm run release` before `pnpm publish`: from 2.0 a provider is released only after its
 * suite of tests/e2e passed on a real account, and one without that run leaves
 * the exports map, the docs and the CHANGELOG of the release. The runs are in
 * tests/e2e/live-runs.json, `{ "<subpath>": { result: 'pass', date, version,
 * commit } }`, written by hand after a green `pnpm test:e2e`;
 * `node scripts/provider-places.js <subpath>` lists what to remove of one that
 * did not run.
 *
 * Usage: node scripts/check-live-runs.js [--file <live-runs.json>]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIVE_RUNS = path.join(ROOT, 'tests', 'e2e', 'live-runs.json');
// The module every transport of a channel fails through.
const CHANNEL_FAILURE = "require('../internal/channel/failure.js')";

/**
 * The subpaths of the exports map that are providers of a channel.
 *
 * @param manifest The package.json.
 * @param root The root of the package.
 * @returns The subpaths, without `./`.
 */
const channelProvidersOf = (manifest, root) => {
  const providers = [];
  for (const key of Object.keys(manifest.exports)) {
    const subpath = key.slice(2);
    const directory = path.join(root, 'src', subpath);
    if (key === '.' || subpath.includes('/') || !fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory)) {
      if (!file.endsWith('.js')) continue;
      if (fs.readFileSync(path.join(directory, file), 'utf8').includes(CHANNEL_FAILURE)) {
        providers.push(subpath);
        break;
      }
    }
  }
  return providers;
};

/**
 * The providers without a live run that passed.
 *
 * @param providers The subpaths of the providers.
 * @param runs The runs, by subpath.
 * @returns The subpaths that did not pass.
 */
const missingRuns = (providers, runs) => {
  const missing = [];
  for (const provider of providers) {
    if (runs[provider]?.result !== 'pass') missing.push(provider);
  }
  return missing;
};

if (require.main === module) {
  const index = process.argv.indexOf('--file');
  const file = index === -1 ? LIVE_RUNS : path.resolve(process.argv[index + 1]);
  const runs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const missing = missingRuns(channelProvidersOf(manifest, ROOT), runs);
  if (missing.length > 0) {
    console.error(
      `These providers have no live run that passed (${path.relative(ROOT, file)}):\n` +
        `  ${missing.join(', ')}\n` +
        'Run their suite of tests/e2e on a real account and record it, or take them out of the ' +
        'release: node scripts/provider-places.js <subpath> lists where each is.',
    );
    process.exitCode = 1;
  } else {
    console.log('Every provider of a channel has a live run that passed.');
  }
}

module.exports = { channelProvidersOf, missingRuns };
