// Not ported: a phone number in E.164 from the way people write one, without
// a library of numbering plans: the international forms (`+`, `00`, and
// `011` in North America) as they are, and a national one made international
// by the calling code of a default country, its trunk prefix dropped
// (`067 123 45 67` in Ukraine is `+380671234567`). It does not check the
// length of a national number against its plan: a provider refuses a number
// that is no number, as `invalid-recipient`.

const { callingCodeIn, callingCodeOf, trunksOf } = require('./calling-codes.js');

const E164 = /^\+[1-9]\d{1,14}$/;
// The digits a number of a country has after its calling code, at least:
// those of Niue and Tokelau have four.
const MIN_NATIONAL_DIGITS = 4;
// What people put between the digits: spaces, dashes, dots, slashes and the
// parentheses of an area code.
const SEPARATORS = new Set([' ', ' ', '-', '‐', '‑', '–', '.', '/', '(', ')']);

/**
 * Whether a value is a phone number in E.164: `+`, a country calling code of
 * ITU-T and at least four more digits, fifteen digits at most.
 *
 * @internal
 */
const isE164 = (value) => {
  if (typeof value !== 'string' || !E164.test(value)) return false;
  const code = callingCodeIn(value.slice(1));
  return code !== undefined && value.length - 1 - code.length >= MIN_NATIONAL_DIGITS;
};

// The digits of a number, or `undefined` for a character that is neither a
// digit nor a separator. A `(0)` after the calling code, as in
// `+44 (0)20 7946 0018`, is the trunk prefix and is left out.
const digitsOf = (text) => {
  let digits = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char >= '0' && char <= '9') digits += char;
    else if (char === '(' && text[i + 1] === '0' && text[i + 2] === ')') i += 2;
    else if (!SEPARATORS.has(char)) return undefined;
  }
  return digits;
};

/**
 * A phone number in E.164, from the way people write one: `+38 (067)
 * 123-45-67`, `00380671234567`, or `067 123 45 67` with `defaultCountry`
 * `UA`.
 *
 * @param input The number.
 * @param options `defaultCountry`, the ISO 3166-1 alpha-2 code of the
 * country of a national number.
 * @returns The number, or `undefined` when it is none, or national without
 * `defaultCountry`.
 * @throws {TypeError} If `defaultCountry` is not the code of a country.
 * @internal
 */
const normalizePhone = (input, options = {}) => {
  const country = options.defaultCountry;
  const countryCode = country === undefined ? undefined : callingCodeOf(country);
  if (country !== undefined && countryCode === undefined) {
    throw new TypeError(`defaultCountry is no country: ${JSON.stringify(country)}.`);
  }
  if (typeof input !== 'string') return undefined;
  const text = input.trim();
  const plus = text.startsWith('+');
  let digits = digitsOf(plus ? text.slice(1) : text);
  if (digits === undefined || digits === '') return undefined;
  let international = plus;
  if (!international && digits.startsWith('00')) {
    international = true;
    digits = digits.slice(2);
  } else if (!international && countryCode === '1' && digits.startsWith('011')) {
    international = true;
    digits = digits.slice(3);
  }
  if (!international) {
    if (countryCode === undefined) return undefined;
    for (const trunk of trunksOf(country)) {
      if (digits.startsWith(trunk)) {
        digits = digits.slice(trunk.length);
        break;
      }
    }
    digits = countryCode + digits;
  }
  const number = `+${digits}`;
  return isE164(number) ? number : undefined;
};

module.exports = { isE164, normalizePhone };
