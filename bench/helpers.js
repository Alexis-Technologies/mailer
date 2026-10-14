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

// Deterministic bytes, so a run measures the same input on every machine.
const bytes = (size) => {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buffer[i] = (i * 31 + 7) & 0xff;
  return buffer;
};

const ATTACHMENT_100K = bytes(100 * 1024);
const ATTACHMENT_1M = bytes(1024 * 1024);

const ADDRESS = 'alex@example.com';

// The record an outbox keeps per message: what to send, to whom, and where it
// is in its lifecycle.
const OUTBOX_RECORD = {
  id: '0193a7c2-6f1e-7c4b-9a51-3d2e8f6b1c0a',
  tenantId: 'acme',
  idempotencyKey: 'acme:password-reset:alex@example.com:2026-10-14T10',
  state: 'queued',
  attempt: 0,
  createdAt: '2026-10-14T10:15:00.000Z',
  message: {
    from: 'Acme <no-reply@acme.example>',
    to: ['alex@example.com'],
    subject: 'Reset your password',
    text: 'Follow the link to reset your password: https://acme.example/reset/abc123',
    html: '<p>Follow the <a href="https://acme.example/reset/abc123">link</a> to reset it.</p>',
    headers: { 'X-Entity-Ref-ID': 'reset-abc123' },
    tags: { kind: 'password-reset' },
  },
};

// The header block a DKIM signature covers (relaxed canonicalization of
// From, To, Subject, Date and Message-ID, then the DKIM-Signature itself).
const DKIM_HEADERS = [
  'from:Acme <no-reply@acme.example>',
  'to:alex@example.com',
  'subject:Reset your password',
  'date:Wed, 14 Oct 2026 10:15:00 +0000',
  'message-id:<0193a7c2-6f1e-7c4b-9a51-3d2e8f6b1c0a@acme.example>',
  'dkim-signature:v=1; a=rsa-sha256; c=relaxed/relaxed; d=acme.example; s=mail; ' +
    'h=from:to:subject:date:message-id; bh=47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=; b=',
].join('\r\n');

module.exports = {
  bench,
  ATTACHMENT_100K,
  ATTACHMENT_1M,
  ADDRESS,
  OUTBOX_RECORD,
  DKIM_HEADERS,
};
