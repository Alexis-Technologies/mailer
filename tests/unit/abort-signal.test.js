// Ported from upyo v0.7.0 (packages/core/src/abort-signal.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { combineSignals } = require('../../src/core/abort-signal.js');

describe('combineSignals', () => {
  it('returns the primary signal when no external signal is provided', () => {
    const controller = new AbortController();
    const combined = combineSignals(controller.signal);

    assert.equal(combined.signal, controller.signal);
    combined.cleanup();
  });

  it('aborts when the primary signal aborts', () => {
    const reason = new Error('Timed out.');
    const timeout = new AbortController();
    const external = new AbortController();
    const combined = combineSignals(timeout.signal, external.signal);

    timeout.abort(reason);

    assert.ok(combined.signal.aborted);
    assert.equal(combined.signal.reason, reason);
    combined.cleanup();
  });

  it('aborts when the external signal aborts', () => {
    const reason = new Error('Cancelled.');
    const timeout = new AbortController();
    const external = new AbortController();
    const combined = combineSignals(timeout.signal, external.signal);

    external.abort(reason);

    assert.ok(combined.signal.aborted);
    assert.equal(combined.signal.reason, reason);
    combined.cleanup();
  });
});
