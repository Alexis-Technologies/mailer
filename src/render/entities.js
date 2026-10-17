// Ported from unemail v0.7.0 (src/render/_html.ts): the character references
// of HTML, `decodeEntities`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a numeric reference past U+10FFFF, to a surrogate or to
// NUL is U+FFFD, as HTML reads it, where unemail threw a RangeError; the named
// references of mail (dashes, quotes, the ellipsis, the euro…) are decoded,
// where unemail knew six; and all of them in one pass.

const NAMED = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['ensp', ' '],
  ['emsp', ' '],
  ['thinsp', ' '],
  ['shy', ''],
  ['zwnj', ''],
  ['zwj', ''],
  ['copy', '©'],
  ['reg', '®'],
  ['trade', '™'],
  ['hellip', '…'],
  ['mdash', '—'],
  ['ndash', '–'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['sbquo', '‚'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['bdquo', '„'],
  ['laquo', '«'],
  ['raquo', '»'],
  ['bull', '•'],
  ['middot', '·'],
  ['euro', '€'],
  ['pound', '£'],
  ['yen', '¥'],
  ['cent', '¢'],
  ['sect', '§'],
  ['para', '¶'],
  ['deg', '°'],
  ['plusmn', '±'],
  ['times', '×'],
  ['divide', '÷'],
  ['larr', '←'],
  ['rarr', '→'],
  ['uarr', '↑'],
  ['darr', '↓'],
]);

const REFERENCE = /&(#[0-9]{1,10}|#[xX][0-9a-fA-F]{1,8}|[a-zA-Z][a-zA-Z0-9]{0,31});/g;

const codePointOf = (code) => {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
  return String.fromCodePoint(code);
};

const decodeReference = (reference, body) => {
  if (body[0] !== '#') return NAMED.get(body) ?? reference;
  const hex = body[1] === 'x' || body[1] === 'X';
  return codePointOf(Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10));
};

/**
 * Decodes the character references of a text, each once, so that `&amp;lt;`
 * is `&lt;`; an unknown name stays as it is.
 *
 * @param text The text.
 * @returns The decoded text.
 * @internal
 */
const decodeEntities = (text) =>
  text.includes('&') ? text.replace(REFERENCE, decodeReference) : text;

module.exports = { decodeEntities };
