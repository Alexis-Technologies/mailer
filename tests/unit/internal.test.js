// The private modules of src/internal/ that the subpaths share.
const { test } = require('node:test');
const assert = require('node:assert');
const { isUnsentRequestError } = require('../../src/internal/unsent.js');

const fetchFailed = (code) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });

test('Internal: a request whose connection was never made was not sent', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'CERT_HAS_EXPIRED']) {
    assert.strictEqual(isUnsentRequestError(fetchFailed(code)), true, code);
  }
  const wrapped = new Error('JMAP request failed', { cause: fetchFailed('ECONNREFUSED') });
  assert.strictEqual(isUnsentRequestError(wrapped), true);
});

test('Internal: a reset, a timeout or a failure without a cause may have been sent', () => {
  for (const error of [
    fetchFailed('ECONNRESET'),
    new DOMException('The operation timed out.', 'TimeoutError'),
    new TypeError('fetch failed'),
    null,
  ]) {
    assert.strictEqual(isUnsentRequestError(error), false);
  }
});
