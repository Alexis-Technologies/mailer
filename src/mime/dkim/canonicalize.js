// Ported from upyo v0.7.0 (packages/mime/src/dkim/canonicalize.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * DKIM Canonicalization algorithms per RFC 6376 Section 3.4.
 *
 * @see https://www.rfc-editor.org/rfc/rfc6376#section-3.4
 */

/**
 * Simple header canonicalization.
 *
 * The "simple" header canonicalization algorithm does not change header
 * fields in any way. Header fields are presented to the signing or
 * verification algorithm exactly as they are in the message.
 *
 * @param name - The header field name
 * @param value - The header field value
 * @returns The canonicalized header line (name:value)
 * @see RFC 6376 Section 3.4.1
 */
const canonicalizeHeaderSimple = (name, value) => {
  return `${name}:${value}`;
};

/**
 * Relaxed header canonicalization.
 *
 * The "relaxed" header canonicalization algorithm:
 * - Convert header field names to lowercase
 * - Unfold header field continuation lines
 * - Collapse whitespace sequences to a single space
 * - Remove leading and trailing whitespace from header field values
 *
 * @param name - The header field name
 * @param value - The header field value
 * @returns The canonicalized header line (name:value)
 * @see RFC 6376 Section 3.4.2
 */
const canonicalizeHeaderRelaxed = (name, value) => {
  // Convert header field name to lowercase
  const canonicalName = name.toLowerCase();

  // Unfold header field value (remove CRLF followed by WSP)
  // and collapse all sequences of WSP to a single space
  const canonicalValue = value
    .replace(/\r\n[\t ]+/g, ' ') // Unfold continuation lines
    .replace(/[\t ]+/g, ' ') // Collapse whitespace sequences
    .trim(); // Remove leading and trailing whitespace

  return `${canonicalName}:${canonicalValue}`;
};

module.exports = { canonicalizeHeaderSimple, canonicalizeHeaderRelaxed };
