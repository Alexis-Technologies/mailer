/**
 * Checks the files `pnpm publish` would pack, run by `prepublishOnly` and in CI:
 * the tarball must hold the root entry, every file the exports map points to
 * and the documents, and nothing the `files` allowlist is meant to keep out
 * (tests, docs, scripts, bench, the repository's tooling). A mistake in `files`
 * or in the exports map otherwise shows up only for the people who install it.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const DOCUMENTS = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md'];
const ALLOWED =
  /^(?:index\.js|index\.d\.ts|src\/.+\.(?:js|d\.ts)|package\.json|README\.md|CHANGELOG\.md|LICENSE|SECURITY\.md)$/;

// What is wrong with the packed paths for a package.json: a required file
// missing, or a file outside the allowlist.
const packProblems = (files, manifest) => {
  const required = new Set(DOCUMENTS);
  required.add(path.posix.normalize(manifest.main));
  required.add(path.posix.normalize(manifest.types));
  for (const entry of Object.values(manifest.exports)) {
    required.add(path.posix.normalize(entry.types));
    required.add(path.posix.normalize(entry.default));
  }
  const packed = new Set(files);
  const problems = [];
  for (const file of required) {
    if (!packed.has(file)) problems.push(`${file} is missing from the tarball`);
  }
  for (const file of files) {
    if (!ALLOWED.test(file)) problems.push(`${file} should not be in the tarball`);
  }
  return problems;
};

const packedFiles = () => {
  const output = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return JSON.parse(output).files.map((file) => file.path);
};

if (require.main === module) {
  const files = packedFiles();
  const problems = packProblems(files, pkg);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exitCode = 1;
  else console.log(`The tarball holds the ${files.length} files it should.`);
}

module.exports = { packProblems };
