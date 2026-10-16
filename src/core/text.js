// The character classes RFC 5322 builds atoms and address literals from, as
// tables indexed by char code, and a scan of them in one pass.

const DOT = 0x2e;

// RFC 5322 §3.2.3: the ASCII characters of an atom.
const ATEXT = new Uint8Array(128);
for (let code = 0x30; code <= 0x39; code++) ATEXT[code] = 1;
for (let code = 0x41; code <= 0x5a; code++) {
  ATEXT[code] = 1;
  ATEXT[code + 0x20] = 1;
}
for (const symbol of "!#$%&'*+-/=?^_`{|}~") ATEXT[symbol.charCodeAt(0)] = 1;

// RFC 5322 §3.4.1: the ASCII characters of an address literal.  Angle brackets
// are excluded although RFC 5322 permits them: they are unambiguous only to a
// parser that tracks the literal, and an identifier carrying one would be
// truncated by every reader that simply looks for the closing bracket.
const DTEXT = new Uint8Array(128);
for (let code = 0x21; code <= 0x7e; code++) {
  if (code < 0x5b || code > 0x5d) DTEXT[code] = 1;
}
DTEXT[0x3c] = 0;
DTEXT[0x3e] = 0;

/**
 * Gives the length of the character at `index` when it is in the ASCII class
 * of `table` or is non-ASCII text that UTF-8 can encode (RFC 6532), and 0
 * when it is neither: an unpaired surrogate cannot be encoded.
 */
const textCharLength = (value, index, end, table) => {
  const code = value.charCodeAt(index);
  if (code < 0x80) return table[code];
  if (code < 0xd800 || code > 0xdfff) return 1;
  if (code > 0xdbff || index + 1 >= end) return 0;
  const next = value.charCodeAt(index + 1);
  return next >= 0xdc00 && next <= 0xdfff ? 2 : 0;
};

/**
 * Tells whether a value is a `dot-atom-text` extended with UTF-8 by RFC 6532:
 * atoms separated by single dots, with no dot at either end.
 *
 * @param value The value to check.
 * @returns Whether the value is a `dot-atom-text`.
 */
const isDotAtomText = (value) => {
  const end = value.length;
  if (end === 0 || value.charCodeAt(0) === DOT || value.charCodeAt(end - 1) === DOT) return false;
  for (let i = 0; i < end;) {
    if (value.charCodeAt(i) === DOT) {
      if (value.charCodeAt(i + 1) === DOT) return false;
      i++;
      continue;
    }
    const length = textCharLength(value, i, end, ATEXT);
    if (length === 0) return false;
    i += length;
  }
  return true;
};

/**
 * Tells whether the characters of `value` from `start` up to `end` are all
 * `dtext` extended with UTF-8 by RFC 6532.
 */
const isDtextBetween = (value, start, end) => {
  for (let i = start; i < end;) {
    const length = textCharLength(value, i, end, DTEXT);
    if (length === 0) return false;
    i += length;
  }
  return true;
};

module.exports = { ATEXT, isDotAtomText, isDtextBetween };
