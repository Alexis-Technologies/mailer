// Ported from upyo v0.7.0 (packages/jmap/src/errors.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isCapabilityError, JmapApiError } = require('../../src/jmap/errors.js');

describe('JmapApiError', () => {
  it('should create an error with message only', () => {
    const error = new JmapApiError('Something went wrong');

    assert.equal(error.message, 'Something went wrong');
    assert.equal(error.name, 'JmapApiError');
    assert.equal(error.statusCode, undefined);
    assert.equal(error.responseBody, undefined);
    assert.equal(error.jmapErrorType, undefined);
    assert.ok(error instanceof Error);
  });

  it('should create an error with status code', () => {
    const error = new JmapApiError('Not found', 404);

    assert.equal(error.message, 'Not found');
    assert.equal(error.statusCode, 404);
  });

  it('should create an error with response body', () => {
    const error = new JmapApiError('Server error', 500, '{"error": "details"}');

    assert.equal(error.message, 'Server error');
    assert.equal(error.statusCode, 500);
    assert.equal(error.responseBody, '{"error": "details"}');
  });

  it('should create an error with JMAP error type', () => {
    const error = new JmapApiError(
      'Unknown capability',
      400,
      undefined,
      'urn:ietf:params:jmap:error:unknownCapability',
    );

    assert.equal(error.jmapErrorType, 'urn:ietf:params:jmap:error:unknownCapability');
  });
});

describe('isCapabilityError', () => {
  it('should return true for capability error', () => {
    const error = new JmapApiError(
      'Unknown capability',
      400,
      undefined,
      'urn:ietf:params:jmap:error:unknownCapability',
    );

    assert.equal(isCapabilityError(error), true);
  });

  it('should return false for other JMAP errors', () => {
    const error = new JmapApiError(
      'Invalid arguments',
      400,
      undefined,
      'urn:ietf:params:jmap:error:invalidArguments',
    );

    assert.equal(isCapabilityError(error), false);
  });

  it('should return false for non-JmapApiError', () => {
    const error = new Error('Regular error');

    assert.equal(isCapabilityError(error), false);
  });

  it('should return false for non-error values', () => {
    assert.equal(isCapabilityError('string'), false);
    assert.equal(isCapabilityError(null), false);
    assert.equal(isCapabilityError(undefined), false);
  });
});
