// Ported from upyo v0.7.0 (packages/core/src/address.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const net = require('node:net');

/**
 * Formats an address object into a string representation.  This function is
 * an inverse of the {@link parseAddress} function.
 *
 * @example Formatting an address with a name
 * ```ts
 * import { type Address, formatAddress } from "@alexify/mailer/address";
 * const address: Address = { name: "John Doe", address: "john@example.com" };
 * console.log(formatAddress(address)); // "John Doe <john@example.com>"
 * ```
 *
 * @example Formatting an address without a name
 * ```ts
 * import { type Address, formatAddress } from "@alexify/mailer/address";
 * const address: Address = { address: "jane@examle.com" };
 * console.log(formatAddress(address)); // "jane@example.com"
 * ```
 *
 * @param address The address object to format.
 * @return A string representation of the address.
 */
const formatAddress = (address) => {
  return address.name == null ? address.address : `${address.name} <${address.address}>`;
};

/**
 * Parses a string representation of an email address into an {@link Address}
 * object.  This function is an inverse of the {@link formatAddress} function.
 *
 * @example Parsing an address with a name
 * ```ts
 * import { parseAddress } from "@alexify/mailer/address";
 * const address = parseAddress("John Doe <john@example.com>");
 * console.log(address); // { name: "John Doe", address: "john@example.com" }
 * ```
 *
 * @example Parsing an address without a name
 * ```ts
 * import { parseAddress } from "@alexify/mailer/address";
 * const address = parseAddress("jane@example.com");
 * console.log(address); // { address: "jane@example.com" }
 * ```
 *
 * @example Trying to parse an invalid address
 * ```ts
 * import { parseAddress } from "@alexify/mailer/address";
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

  // Check for name and angle bracket format: "Name <email@domain.com>"
  const nameAngleBracketMatch = trimmed.match(/^(.+?)\s*<(.+?)>$/);
  if (nameAngleBracketMatch) {
    const name = nameAngleBracketMatch[1].trim();
    const email = nameAngleBracketMatch[2].trim();

    if (!isValidEmail(email)) {
      return undefined;
    }

    // Remove quotes from name if present
    const cleanName = name.replace(/^"(.+)"$/, '$1');
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
  for (let i = 1; i < email.length; i++) {
    const code = email.charCodeAt(i);
    if (code === 0x5c) {
      i++;
    } else if (code === 0x22) {
      return email.charCodeAt(i + 1) === 0x40 ? i + 1 : -1;
    }
  }
  return -1;
};

const isValidLocalPart = (localPart) => {
  if (!localPart || localPart.length === 0 || new TextEncoder().encode(localPart).byteLength > 64) {
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

  // Check for dot-atom format (RFC 5322)
  // No leading/trailing dots, no consecutive dots
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return false;
  }

  // RFC 6531 extends atext with any well-formed non-ASCII UTF-8 character.
  const asciiAtext = /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]$/;
  return localPart.split('.').every(
    (atom) =>
      atom.length > 0 &&
      Array.from(atom).every((character) => {
        if (asciiAtext.test(character)) return true;
        const codePoint = character.codePointAt(0);
        return (
          codePoint != null && codePoint > 0x7f && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        );
      }),
  );
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
 * import { isEmailAddress } from "@alexify/mailer/address";
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

module.exports = { formatAddress, parseAddress, isEmailAddress };
