// Not ported from upyo: keeps email addresses out of error text that goes to
// telemetry and logs, such as an SMTP rejection naming its recipient.

const REDACTED = '[REDACTED]';

// The characters that end an address in free text: whitespace and controls,
// quotes, brackets, and the separators of address lists and SMTP replies.
const SEPARATOR = new Uint8Array(128);
for (let code = 0; code <= 0x20; code++) SEPARATOR[code] = 1;
for (const symbol of '"\'(),:;<>[\\]') SEPARATOR[symbol.charCodeAt(0)] = 1;
SEPARATOR[0x7f] = 1;

// How far a quoted local part or a domain literal is looked for: a local part
// is at most 64 octets (RFC 5321 §4.5.3.1.1), plus its quotes or brackets.
const MAX_BRACKETED_LENGTH = 66;

const isAddressCharacter = (code) => code > 0x7f || SEPARATOR[code] !== 1;

// The index where a quoted local part ending right before `at` opens, or `at`.
const findQuotedStart = (text, at, floor) => {
  if (text.charCodeAt(at - 1) !== 0x22) return at;
  const limit = Math.max(floor, at - MAX_BRACKETED_LENGTH);
  for (let i = at - 2; i >= limit; i--) {
    if (text.charCodeAt(i) === 0x22) return i;
  }
  return at;
};

// The index after a domain literal starting right after `at`, or `at + 1`.
const findLiteralEnd = (text, at) => {
  if (text.charCodeAt(at + 1) !== 0x5b) return at + 1;
  const limit = Math.min(text.length, at + MAX_BRACKETED_LENGTH);
  for (let i = at + 2; i < limit; i++) {
    if (text.charCodeAt(i) === 0x5d) return i + 1;
  }
  return at + 1;
};

/**
 * Replaces every email address in a text with `[REDACTED]`.  It scans from
 * each "@" to the separators around it, so it runs in linear time on any
 * input, unlike a pattern that backtracks over a long run without an "@".
 *
 * @param text Free text, such as an error message.
 * @returns The text without its addresses.
 * @internal
 */
const redactAddresses = (text) => {
  let result = '';
  let copied = 0;
  let at = text.indexOf('@');
  while (at !== -1) {
    let start = at;
    while (start > copied && isAddressCharacter(text.charCodeAt(start - 1))) start--;
    if (start === at) start = findQuotedStart(text, at, copied);
    let end = at + 1;
    while (end < text.length && isAddressCharacter(text.charCodeAt(end))) end++;
    if (end === at + 1) end = findLiteralEnd(text, at);
    if (start < at && end > at + 1) {
      result += text.slice(copied, start) + REDACTED;
      copied = end;
    }
    at = text.indexOf('@', end);
  }
  return copied === 0 ? text : result + text.slice(copied);
};

module.exports = { redactAddresses };
