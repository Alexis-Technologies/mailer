// Ported from upyo v0.7.0 (packages/mime/src/dkim/canonicalize.ts and sign.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
//
// The body canonicalization of RFC 6376 over a whole string, and signing of a
// whole message with it.  The library hashes a body as it streams
// (BodyHasher), so these left src/ after the port; the tests keep them as the
// reference the streaming hash and the signatures are checked against.

const { createHash } = require('node:crypto');
const { signWithBodyHash } = require('../../../src/mime/dkim/sign.js');
const { DEFAULT_CANONICALIZATION } = require('../../../src/mime/dkim/types.js');

/**
 * Simple body canonicalization.
 *
 * The "simple" body canonicalization algorithm:
 * - Ignores all empty lines at the end of the message body
 * - If the body is empty, a single CRLF is appended
 * - If there is no trailing CRLF on the body, a CRLF is added
 *
 * @param body - The message body
 * @returns The canonicalized body
 * @see RFC 6376 Section 3.4.3
 */
const canonicalizeBodySimple = (body) => {
  if (body === '') {
    return '\r\n';
  }

  // Remove trailing empty lines (lines containing only CRLF)
  let result = body.replace(/(\r\n)+$/, '');

  // Ensure the body ends with a single CRLF
  if (!result.endsWith('\r\n')) {
    result += '\r\n';
  }

  return result;
};

/**
 * Relaxed body canonicalization.
 *
 * The "relaxed" body canonicalization algorithm:
 * - Reduce all sequences of WSP within a line to a single SP
 * - Remove all trailing WSP at the end of each line (before CRLF)
 * - Ignore all empty lines at the end of the message body
 * - If the body is non-empty and doesn't end with CRLF, add CRLF
 *
 * @param body - The message body
 * @returns The canonicalized body
 * @see RFC 6376 Section 3.4.4
 */
const canonicalizeBodyRelaxed = (body) => {
  if (body === '') {
    return '';
  }

  // Ensure body ends with CRLF for processing
  let processedBody = body;
  if (!processedBody.endsWith('\r\n')) {
    processedBody += '\r\n';
  }

  // Process each line
  const lines = processedBody.split('\r\n');
  const canonicalizedLines = [];

  for (let i = 0; i < lines.length - 1; i++) {
    // -1 because split creates an empty element after final CRLF
    let line = lines[i];

    // Collapse WSP sequences to single space
    line = line.replace(/[\t ]+/g, ' ');

    // Remove trailing WSP
    line = line.replace(/[\t ]+$/, '');

    canonicalizedLines.push(line);
  }

  // Remove trailing empty lines
  while (
    canonicalizedLines.length > 0 &&
    canonicalizedLines[canonicalizedLines.length - 1] === ''
  ) {
    canonicalizedLines.pop();
  }

  // If no content remains, return empty string
  if (canonicalizedLines.length === 0) {
    return '';
  }

  // Join with CRLF and add final CRLF
  return canonicalizedLines.join('\r\n') + '\r\n';
};

/**
 * Signs a raw email message with DKIM, hashing its body as a whole.
 *
 * @param rawMessage The complete raw email message (headers + body).
 * @param config DKIM signature configuration.
 * @param signal Optional cancellation signal.
 * @returns The DKIM-Signature header result.
 */
const signMessage = async (rawMessage, config, signal) => {
  signal?.throwIfAborted();
  const separator = rawMessage.indexOf('\r\n\r\n');
  const body = separator === -1 ? '' : rawMessage.substring(separator + 4);
  const canonical = (config.canonicalization ?? DEFAULT_CANONICALIZATION).endsWith('/simple')
    ? canonicalizeBodySimple(body)
    : canonicalizeBodyRelaxed(body);
  const bodyHash = createHash('sha256').update(canonical).digest('base64');
  return await signWithBodyHash(rawMessage, config, bodyHash, signal);
};

module.exports = { canonicalizeBodyRelaxed, canonicalizeBodySimple, signMessage };
