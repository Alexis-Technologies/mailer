// Runs the suites of the real stores, tests/mongodb and tests/bullmq, as a
// step of a release: unlike `pnpm test:mongodb` and `pnpm test:bullmq`, which
// skip their tests without a store, it fails when either is not given, so a
// release cannot pass them unrun.
//
//   docker compose -f tests/mongodb/docker-compose.yml up -d --wait
//   docker compose -f tests/bullmq/docker-compose.yml up -d --wait
//   MONGODB_URL='mongodb://localhost:27027/?replicaSet=rs0' \
//   BULLMQ_REDIS_URL=redis://localhost:6390 pnpm test:stores

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SUITES = [
  { variable: 'MONGODB_URL', directory: 'tests/mongodb' },
  { variable: 'BULLMQ_REDIS_URL', directory: 'tests/bullmq' },
];

const missing = [];
for (const suite of SUITES) {
  if ((process.env[suite.variable] ?? '') === '') missing.push(suite.variable);
}
if (missing.length > 0) {
  console.error(
    `test:stores needs ${missing.join(' and ')}: start the stores of tests/mongodb and ` +
      'tests/bullmq (docker compose), and give their URLs.',
  );
  process.exit(1);
}

for (const suite of SUITES) {
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-timeout=120000', `${suite.directory}/*.test.js`],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
