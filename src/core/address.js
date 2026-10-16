// Ported from upyo v0.7.0 (packages/core/src/address.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const net = require('node:net');
const { ATEXT, isDotAtomText } = require('./text.js');

/**
 * Formats an address object into a string representation.  This function is
 * an inverse of the {@link parseAddress} function.
 *
 * @example Formatting an address with a name
 * ```ts
 * import { type Address, formatAddress } from "@alexify/mailer";
 * const address: Address = { name: "John Doe", address: "john@example.com" };
 * console.log(formatAddress(address)); // "John Doe <john@example.com>"
 * ```
 *
 * @example Formatting an address without a name
 * ```ts
 * import { type Address, formatAddress } from "@alexify/mailer";
 * const address: Address = { address: "jane@examle.com" };
 * console.log(formatAddress(address)); // "jane@example.com"
 * ```
 *
 * @param address The address object to format.
 * @return A string representation of the address.
 */
const formatAddress = (address) => {
  return address.name == null ? address.address : formatMailbox(address);
};

// A phrase of atoms separated by spaces goes as it is; anything else, such as
// "<", ",", "@" or "." that would make a second mailbox or end this one, goes
// as a quoted string (RFC 5322 §3.4).  So does text that reads as an encoded
// word, which a reader would otherwise decode (RFC 2047 §5).
const isAtomPhrase = (name) => {
  const last = name.length - 1;
  if (last < 0 || name.charCodeAt(0) === 0x20 || name.charCodeAt(last) === 0x20) return false;
  for (let i = 0; i <= last; i++) {
    const code = name.charCodeAt(i);
    if (code !== 0x20 && (code > 0x7f || ATEXT[code] !== 1)) return false;
  }
  return !name.includes('=?');
};

const quoteString = (text) => `"${text.replace(/[\\"]/g, '\\$&')}"`;

/**
 * Formats a display name of printable text: as it is when it is atoms, as a
 * quoted string otherwise.
 *
 * @param name A display name with no control character.
 * @returns The phrase for the header.
 * @internal
 */
const formatPhrase = (name) => (isAtomPhrase(name) ? name : quoteString(name));

const checkDisplayName = (name) => {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
      throw new TypeError('A display name must not contain a control character.');
    }
  }
};

/**
 * Formats a mailbox for a header or an API that takes one as a string: the
 * display name as atoms when it has nothing else, otherwise as a quoted string.
 *
 * @param address The address, with or without a display name.
 * @returns `name <address>`, `"name" <address>`, or the bare address.
 * @throws {TypeError} If the display name holds a control character.
 * @internal
 */
const formatMailbox = (address) => {
  if (!address.name) return address.address;
  checkDisplayName(address.name);
  return `${formatPhrase(address.name)} <${address.address}>`;
};

/**
 * Formats a mailbox with the display name always quoted, for APIs whose
 * output has always been `"name" <address>`.
 *
 * @param address The address, with or without a display name.
 * @returns `"name" <address>`, or the bare address.
 * @throws {TypeError} If the display name holds a control character.
 * @internal
 */
const formatQuotedMailbox = (address) => {
  if (!address.name) return address.address;
  checkDisplayName(address.name);
  return `${quoteString(address.name)} <${address.address}>`;
};

/**
 * Parses a string representation of an email address into an {@link Address}
 * object.  This function is an inverse of the {@link formatAddress} function.
 *
 * @example Parsing an address with a name
 * ```ts
 * import { parseAddress } from "@alexify/mailer";
 * const address = parseAddress("John Doe <john@example.com>");
 * console.log(address); // { name: "John Doe", address: "john@example.com" }
 * ```
 *
 * @example Parsing an address without a name
 * ```ts
 * import { parseAddress } from "@alexify/mailer";
 * const address = parseAddress("jane@example.com");
 * console.log(address); // { address: "jane@example.com" }
 * ```
 *
 * @example Trying to parse an invalid address
 * ```ts
 * import { parseAddress } from "@alexify/mailer";
 * const address = parseAddress("invalid-email");
 * console.log(address); // undefined
 * ```
 *
 * @param address The string representation of the address to parse.
 * @returns An {@link Address} object if the parsing is successful,
 *          or `undefined` if the input is invalid.
 */
const parseAddress = (address) => {
  if (!address || typeof address !== 'string') {
    return undefined;
  }

  const trimmed = address.trim();
  if (!trimmed) {
    return undefined;
  }

  // A quoted display name may hold "<", ">" and ",", so its end is found by
  // scanning the quoted string rather than by the first "<".
  if (trimmed.charCodeAt(0) === 0x22) {
    const nameEnd = findClosingQuote(trimmed);
    const rest = nameEnd === -1 ? '' : trimmed.slice(nameEnd + 1).trim();
    if (rest.startsWith('<') && rest.endsWith('>')) {
      const email = rest.slice(1, -1).trim();
      if (!isValidEmail(email)) {
        return undefined;
      }
      return { name: trimmed.slice(1, nameEnd).replace(/\\(.)/g, '$1'), address: email };
    }
  }

  // Check for name and angle bracket format: "Name <email@domain.com>"
  const nameAngleBracketMatch = trimmed.match(/^(.+?)\s*<(.+?)>$/);
  if (nameAngleBracketMatch) {
    const name = nameAngleBracketMatch[1].trim();
    const email = nameAngleBracketMatch[2].trim();

    if (!isValidEmail(email)) {
      return undefined;
    }

    // Remove quotes from name if present, and the backslashes of the pairs
    // they quote, so a name formatted by formatAddress() comes back as it was.
    const quoted = /^"(.+)"$/.exec(name);
    const cleanName = quoted == null ? name : quoted[1].replace(/\\(.)/g, '$1');
    return { name: cleanName, address: email };
  }

  // Check for angle bracket format without name: "<email@domain.com>"
  const angleBracketMatch = trimmed.match(/^<(.+?)>$/);
  if (angleBracketMatch) {
    const email = angleBracketMatch[1].trim();

    if (!isValidEmail(email)) {
      return undefined;
    }

    return { address: email };
  }

  // Check for plain email format: "email@domain.com"
  if (isValidEmail(trimmed)) {
    return { address: trimmed };
  }

  return undefined;
};

const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Prevent SMTP command injection by disallowing newlines
  if (email.includes('\r') || email.includes('\n')) {
    return false;
  }

  // Only a quoted local part may hold an @, and only at its start may a quote
  // open; the domain holds none.  Toggling on every quote let a quote in the
  // domain hide a second @ from the scan.
  const atIndex = findLocalPartEnd(email);
  if (atIndex < 1 || email.indexOf('@', atIndex + 1) !== -1) {
    return false;
  }

  const localPart = email.substring(0, atIndex);
  const domainPart = email.substring(atIndex + 1);

  return isValidLocalPart(localPart) && isValidDomainPart(domainPart);
};

const findLocalPartEnd = (email) => {
  if (email.charCodeAt(0) !== 0x22) return email.indexOf('@');
  const quoteEnd = findClosingQuote(email);
  return quoteEnd !== -1 && email.charCodeAt(quoteEnd + 1) === 0x40 ? quoteEnd + 1 : -1;
};

// The index of the quote that closes the quoted string opening `text`, past
// its backslash pairs, or -1.
const findClosingQuote = (text) => {
  for (let i = 1; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x5c) {
      i++;
    } else if (code === 0x22) {
      return i;
    }
  }
  return -1;
};

const isValidLocalPart = (localPart) => {
  if (!localPart || localPart.length === 0 || Buffer.byteLength(localPart, 'utf8') > 64) {
    return false;
  }

  // Check for quoted string format
  if (localPart.startsWith('"') && localPart.endsWith('"')) {
    const quotedContent = localPart.slice(1, -1);
    for (let i = 0; i < quotedContent.length;) {
      const codePoint = quotedContent.codePointAt(i);
      if (codePoint == null || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return false;
      }
      if (codePoint > 0x7f) {
        i += codePoint > 0xffff ? 2 : 1;
        continue;
      }

      if (codePoint === 0x5c) {
        const escapedCodePoint = quotedContent.codePointAt(i + 1);
        if (escapedCodePoint == null || escapedCodePoint < 0x20 || escapedCodePoint > 0x7e) {
          return false;
        }
        i += 2;
        continue;
      }

      if (codePoint < 0x20 || codePoint === 0x22 || codePoint === 0x5c || codePoint > 0x7e) {
        return false;
      }
      i++;
    }
    return true;
  }

  // Check for dot-atom format (RFC 5322), whose atext RFC 6531 extends with any
  // well-formed non-ASCII UTF-8 character.
  return isDotAtomText(localPart);
};

const isValidDomainPart = (domainPart) => {
  if (!domainPart || domainPart.length === 0 || domainPart.length > 253) {
    return false;
  }

  // Check for domain literal format [IP]
  if (domainPart.startsWith('[') && domainPart.endsWith(']')) {
    return isValidAddressLiteral(domainPart.slice(1, -1));
  }

  // URL.canParse() reads "@", ":", "/", "?" and "#" as delimiters of other
  // parts of a URL, so on its own it accepts a domain that carries a port, a
  // path or userinfo, such as "example.com> NOTIFY=NEVER …@x.com", which
  // would end the path of an SMTP command early.  A host name has letters,
  // digits, hyphens and dots, plus the non-ASCII characters of an
  // internationalized name.
  if (!hasHostNameCharacters(domainPart)) {
    return false;
  }

  // For regular domain format, use URL.canParse() for validation
  try {
    // URL.canParse() expects a valid URL, so we prepend http://
    return URL.canParse(`http://${domainPart}/`);
  } catch {
    return false;
  }
};

const hasHostNameCharacters = (domainPart) => {
  let previous = 0x2e;
  for (let i = 0; i < domainPart.length; i++) {
    const code = domainPart.charCodeAt(i);
    if (code === 0x2e && previous === 0x2e) return false;
    const isLetterOrDigit =
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x30 && code <= 0x39);
    if (!isLetterOrDigit && code !== 0x2d && code !== 0x2e && code < 0x80) return false;
    previous = code;
  }
  return true;
};

// RFC 5321 §4.1.3: an IPv4 address, or an IPv6 one after the "IPv6:" tag
// (taken without the tag too, as written in practice).  A zone index has no
// place in an address.
const isValidAddressLiteral = (literal) => {
  if (literal.includes('%')) return false;
  if (literal.slice(0, 5).toLowerCase() === 'ipv6:') return net.isIPv6(literal.slice(5));
  return net.isIPv4(literal) || net.isIPv6(literal);
};

/**
 * Type guard function that checks if a given value is a valid email address.
 *
 * @example
 * ```ts
 * import { isEmailAddress } from "@alexify/mailer";
 *
 * const userInput = "user@example.com";
 * if (isEmailAddress(userInput)) {
 *   // TypeScript now knows userInput is EmailAddress type
 *   console.log(userInput); // Type: `${string}@${string}`
 * }
 * ```
 *
 * @param email The value to check
 * @returns `true` if the value is a valid email address, `false` otherwise
 */
const isEmailAddress = (email) => {
  return typeof email === 'string' && isValidEmail(email);
};

module.exports = {
  formatAddress,
  formatMailbox,
  formatPhrase,
  formatQuotedMailbox,
  parseAddress,
  isEmailAddress,
};
