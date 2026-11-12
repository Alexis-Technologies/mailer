/**
 * Lists where a provider is, for the release that leaves it out: a provider
 * of a channel without a live run leaves the exports map, its size budget,
 * its tests of types, its docs page and the sidebar, the CHANGELOG, the
 * README and the table of exports, the delivery matrix of the channels and
 * the comparison. Nothing is changed: the list is to go through by hand.
 *
 * Usage: node scripts/provider-places.js <subpath>
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'package.json',
  'scripts/size-budgets.json',
  'CHANGELOG.md',
  'README.md',
  'docs/.vitepress/config.mts',
  'docs/api/exports.md',
  'docs/comparison-channels.json',
  'tests/helpers/delivery/channels.js',
  'tests/e2e/channels.e2e.test.js',
  'tests/e2e/live-runs.json',
];

/**
 * The lines that name a provider: its entry, its import and its pages.
 *
 * @param subpath The subpath, without `./`.
 * @param root The root of the package.
 * @returns `{ file, line, text }` of each, and the files of its own.
 */
const placesOf = (subpath, root) => {
  const names = [
    `"./${subpath}"`,
    `/${subpath}'`,
    `/${subpath}"`,
    `/${subpath})`,
    `/${subpath}\``,
    `/${subpath}/`,
  ];
  const places = [];
  for (const file of FILES) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index++) {
      if (names.some((name) => lines[index].includes(name))) {
        places.push({ file, line: index + 1, text: lines[index].trim() });
      }
    }
  }
  const own = [
    `src/${subpath}`,
    `docs/channels/${subpath}.md`,
    `tests/unit/${subpath}.test.js`,
    `tests/types/${subpath}.test-d.ts`,
  ];
  return { places, files: own.filter((file) => fs.existsSync(path.join(root, file))) };
};

if (require.main === module) {
  const subpath = process.argv[2];
  if (subpath === undefined) {
    console.error('Usage: node scripts/provider-places.js <subpath>');
    process.exitCode = 1;
  } else {
    const { places, files } = placesOf(subpath, ROOT);
    for (const file of files) console.log(`${file} (its own)`);
    for (const place of places) console.log(`${place.file}:${place.line}: ${place.text}`);
  }
}

module.exports = { placesOf };
