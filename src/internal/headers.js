// Not ported: small helpers of header names that the converters of
// the HTTP providers share.
// Also ported from nodemailer v10.0.16 (src/mime-node/index.ts): the case of a
// field name, `_normalizeHeaderKey`.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman

/**
 * The names, in lower case, as a set built in one pass.
 *
 * @param names Header names, such as the keys of a Map.
 * @returns A set of the lower-case names.
 * @internal
 */
const lowerCaseNames = (names) => {
  const set = new Set();
  for (const name of names) set.add(name.toLowerCase());
  return set;
};

// Each word of a field name capitalized, as nodemailer writes it, the
// abbreviations its readers know upper-cased: `Headers` keeps names in lower
// case, and `list-unsubscribe-post` reads as a field nobody named.
const UPPER_CASE_PARTS =
  /^x-smtpapi$|^(?:mime|dkim|arc|bimi)\b|^[a-z]|-(?:spf|fbl|id|md5)$|-[a-z]/g;
/**
 * A field name as nodemailer writes it.
 *
 * @param name A field name in lower case, as `Headers` keeps it.
 * @returns The name capitalized.
 * @internal
 */
const canonicalHeaderName = (name) =>
  name === 'content-features'
    ? 'Content-features'
    : name.replace(UPPER_CASE_PARTS, (part) => part.toUpperCase());

module.exports = { canonicalHeaderName, lowerCaseNames };
