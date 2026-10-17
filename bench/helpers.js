const { performance } = require('node:perf_hooks');

const WARMUP_ITERATIONS = 2_000;
const MEASURE_MS = 1_000;

const bench = (name, fn, options = {}) => {
  const { warmup = WARMUP_ITERATIONS, measureMs = MEASURE_MS, quiet = false } = options;
  for (let i = 0; i < warmup; i++) fn();
  let iterations = 0;
  const start = performance.now();
  while (performance.now() - start < measureMs) {
    fn();
    iterations++;
  }
  const elapsed = performance.now() - start;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const ops = opsPerSec.toLocaleString('en-US').padStart(12);
  if (!quiet) console.log(`${name.padEnd(52)} ${ops} ops/sec`);
  return { name, opsPerSec };
};

// The same measure for an asynchronous scenario, each call awaited.
const benchAsync = async (name, fn, options = {}) => {
  const { warmup = WARMUP_ITERATIONS, measureMs = MEASURE_MS, quiet = false } = options;
  for (let i = 0; i < warmup; i++) await fn();
  let iterations = 0;
  const start = performance.now();
  while (performance.now() - start < measureMs) {
    await fn();
    iterations++;
  }
  const elapsed = performance.now() - start;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const ops = opsPerSec.toLocaleString('en-US').padStart(12);
  if (!quiet) console.log(`${name.padEnd(52)} ${ops} ops/sec`);
  return { name, opsPerSec };
};

// Deterministic bytes, so a run measures the same input on every machine.
const bytes = (size) => {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buffer[i] = (i * 31 + 7) & 0xff;
  return buffer;
};

const ATTACHMENT_1M = bytes(1024 * 1024);

const ADDRESS = 'alex@example.com';

module.exports = { bench, benchAsync, ATTACHMENT_1M, ADDRESS };
