// Ported from nodemailer v10.0.16 (src/mailer/mail-message.ts): the List-*
// header fields of RFC 2369 and RFC 2919, `_getListHeaders` and `_formatListUrl`.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
// Also ported from unemail v0.7.0 (src/core/message.ts): List-Unsubscribe-Post,
// the one-click unsubscription of RFC 8058.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a URL, comment or list ID nodemailer would strip, guess a
// scheme for or encode is refused, the fields of one list go as one field each,
// and one-click needs an https URL.

const { formatPhrase } = require('./address.js');
const { isDotAtomText } = require('./text.js');

// The fields of RFC 2369 a list may carry URLs in, by the key that names them.
const URL_FIELDS = new Map([
  ['help', 'List-Help'],
  ['unsubscribe', 'List-Unsubscribe'],
  ['subscribe', 'List-Subscribe'],
  ['post', 'List-Post'],
  ['owner', 'List-Owner'],
  ['archive', 'List-Archive'],
]);

const URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const BARE_ADDRESS = /^[^@]+@[^@]+$/;

const throwTypeError = (message) => {
  throw new TypeError(message);
};

// Printable ASCII only: a value beyond it would make the MIME writer encode
// the whole field, angle brackets and all.
const isPrintableAscii = (text) => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
};

// Whitespace, controls and angle brackets would end the bracketed URL, and
// nothing in a URL needs them unencoded.
const hasUrlBreak = (text) => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || code === 0x3c || code === 0x3e) return true;
  }
  return false;
};

// A bare address is a mailto URL, as nodemailer reads one; anything else
// needs its scheme, which nodemailer would have guessed as http.
const listUrlOf = (field, text) => {
  const invalid = () => throwTypeError(`Invalid ${field} URL: ${JSON.stringify(text)}`);
  if (typeof text !== 'string' || text === '' || hasUrlBreak(text)) invalid();
  let candidate;
  if (SCHEME.test(text)) candidate = text;
  else if (BARE_ADDRESS.test(text)) candidate = `mailto:${text}`;
  else invalid();
  let url;
  try {
    url = new URL(candidate);
  } catch {
    invalid();
  }
  if (!URL_SCHEMES.has(url.protocol)) {
    throwTypeError(`A ${field} URL must be http, https or mailto: ${JSON.stringify(text)}`);
  }
  return url.href;
};

// A comment as ctext, with the specials that would end or nest it escaped.
const formatComment = (field, comment) => {
  if (typeof comment !== 'string' || !isPrintableAscii(comment)) {
    throwTypeError(`A ${field} comment must be printable ASCII: ${JSON.stringify(comment)}`);
  }
  return comment.replace(/[()\\]/g, '\\$&');
};

// The URLs of one field, comma-separated, and whether one of them is https.
const formatEntries = (field, entries) => {
  let text = '';
  let hasHttps = false;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isObject = entry !== null && typeof entry === 'object';
    const href = listUrlOf(field, isObject ? entry.url : entry);
    if (href.startsWith('https:')) hasHttps = true;
    const comment =
      isObject && entry.comment != null ? ` (${formatComment(field, entry.comment)})` : '';
    text += `${i === 0 ? '' : ', '}<${href}>${comment}`;
  }
  return { text, hasHttps };
};

// RFC 2919: a list ID is a dot-atom with a namespace, `list.example.com`.
const formatListId = (entry) => {
  const isObject = entry !== null && typeof entry === 'object';
  const id = isObject ? entry.id : entry;
  const isId =
    typeof id === 'string' && isPrintableAscii(id) && isDotAtomText(id) && id.includes('.');
  if (!isId) throwTypeError(`Invalid list ID: ${JSON.stringify(id)}`);
  const name = isObject ? entry.name : undefined;
  if (name == null) return `<${id}>`;
  if (typeof name !== 'string' || name === '' || !isPrintableAscii(name)) {
    throwTypeError(`A list name must be printable ASCII: ${JSON.stringify(name)}`);
  }
  return `${formatPhrase(name)} <${id}>`;
};

/**
 * Turns the `list` of a message into its header fields: `List-Id`, the URL
 * fields of RFC 2369 and, with `oneClick`, `List-Unsubscribe-Post` (RFC 8058).
 *
 * @param list The list fields, or `null`/`undefined` for none.
 * @returns The fields, `{ name, value }` each, in the order of the keys.
 * @throws {TypeError} If a key is unknown, a URL is not an http, https or
 * mailto URL, a comment or name is not printable ASCII, the list ID is not a
 * dot-atom with a namespace, or `oneClick` comes without an https URL to
 * unsubscribe.
 * @internal
 */
const listFieldsOf = (list) => {
  const fields = [];
  if (list == null) return fields;
  if (typeof list !== 'object' || Array.isArray(list)) {
    throwTypeError('The list fields must be an object.');
  }
  let canUnsubscribeByPost = false;
  for (const key in list) {
    if (!Object.hasOwn(list, key)) continue;
    const entry = list[key];
    if (entry == null || key === 'oneClick') continue;
    if (key === 'id') {
      fields.push({ name: 'List-Id', value: formatListId(entry) });
      continue;
    }
    const name = URL_FIELDS.get(key) ?? throwTypeError(`Unknown list field: ${key}`);
    const entries = Array.isArray(entry) ? entry : [entry];
    if (entries.length === 0) continue;
    const formatted = formatEntries(name, entries);
    if (key === 'unsubscribe') canUnsubscribeByPost = formatted.hasHttps;
    fields.push({ name, value: formatted.text });
  }
  const { oneClick } = list;
  if (oneClick != null && typeof oneClick !== 'boolean') {
    throwTypeError('list.oneClick must be a boolean.');
  }
  if (oneClick === true) {
    if (!canUnsubscribeByPost) {
      throwTypeError('One-click unsubscription needs an https URL in list.unsubscribe.');
    }
    fields.push({ name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' });
  }
  return fields;
};

/**
 * Adds the list fields of a message to its headers.
 *
 * @param headers The headers given with the message.
 * @param list The list fields.
 * @returns The same headers.
 * @throws {TypeError} If a list field is invalid, or the headers already carry
 * one of the fields the list sets.
 * @internal
 */
const addListHeaders = (headers, list) => {
  const fields = listFieldsOf(list);
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (headers.has(field.name)) {
      throwTypeError(`${field.name} is given both in list and in headers.`);
    }
    headers.set(field.name, field.value);
  }
  return headers;
};

module.exports = { addListHeaders, listFieldsOf };
