// Ported from upyo v0.7.0 (packages/core/src/message-id.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Generates a globally unique message identifier rooted in a domain.
 *
 * The identifier is a random UUID followed by `@` and the domain, which makes
 * it unique within the scope RFC 5322 §3.6.4 asks the generator to ensure.
 * The same construction is used for attachment content IDs.
 *
 * The domain has to be a valid identifier right-hand side: a dot-atom such as
 * `example.com` or an address literal such as `[192.0.2.1]`.  A URL, a host
 * with a port, or a value carrying whitespace is rejected.  A domain written
 * in a non-Latin script is converted to its ASCII (Punycode) form so that the
 * *generated* identifier travels through mail software that predates RFC 6532;
 * a non-ASCII domain that is not a DNS name is kept as it is.  An identifier
 * supplied by a caller is never rewritten this way.
 *
 * @example
 * ```ts
 * import { generateMessageId } from "@alexify/mailer";
 * const messageId = generateMessageId("example.com");
 * // "1e2ee2e1-…-…@example.com"
 * ```
 *
 * @param domain The domain the identifier is rooted in.
 * @returns A bare message identifier, without angle brackets.
 * @throws {TypeError} If the domain is not a valid identifier right-hand side.
 */
const generateMessageId = (domain) => {
  return `${crypto.randomUUID()}@${normalizeIdRight(domain)}`;
};

/**
 * Parses a message identifier, with or without the enclosing angle brackets,
 * into its bare form.
 *
 * This is the inverse of {@link formatMessageId}, and it returns `undefined`
 * rather than throwing, the way {@link parseAddress} does.
 *
 * It parses *one* identifier.  An `In-Reply-To` or `References` field arriving
 * from elsewhere may hold several identifiers, comments, folded whitespace, and
 * obsolete syntax, none of which this function accepts; splitting such a field
 * is the caller's job.
 *
 * @example
 * ```ts
 * import { parseMessageId } from "@alexify/mailer";
 * parseMessageId("<abc@example.com>");  // "abc@example.com"
 * parseMessageId("not an identifier");  // undefined
 * ```
 *
 * @param value The identifier to parse.
 * @returns The bare identifier, or `undefined` if the value is not one.
 */
const parseMessageId = (value) => {
  if (typeof value !== 'string') return undefined;
  const bare =
    value.length > 1 && value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
  return isMessageId(bare) ? bare : undefined;
};

/**
 * Formats a bare message identifier for a header field, by enclosing it in
 * angle brackets.
 *
 * This is the inverse of {@link parseMessageId}.  It takes the *bare* form, so
 * an already enclosed identifier is rejected rather than enclosed twice.  What
 * it guarantees is syntax; a header field also has to fit the line-length limit
 * the serializing transport enforces.
 *
 * @example
 * ```ts
 * import { formatMessageId } from "@alexify/mailer";
 * formatMessageId("abc@example.com");  // "<abc@example.com>"
 * ```
 *
 * @param id The bare identifier to format.
 * @returns The identifier enclosed in angle brackets.
 * @throws {TypeError} If the value is not a valid bare identifier.
 */
const formatMessageId = (id) => {
  if (!isMessageId(id)) {
    throw new TypeError(`Invalid message ID: ${JSON.stringify(id)}`);
  }
  return `<${id}>`;
};

/**
 * Tells whether a value is a message identifier in its bare form.
 *
 * The accepted syntax is `id-left "@" id-right` from RFC 5322 §3.6.4, extended
 * with UTF-8 by RFC 6532, and then narrowed by a few deliberate restrictions
 * described on {@link isDotAtomText} and {@link isNoFoldLiteral}.
 *
 * @param id The value to check.
 * @returns Whether the value is a bare message identifier.
 */
const isMessageId = (id) => {
  // A modern `id-left` is a dot-atom, which cannot contain an at sign, so the
  // first one separates the two halves.  An `id-right` written as an address
  // literal may contain further at signs.
  const separator = id.indexOf('@');
  if (separator < 0) return false;
  const left = id.slice(0, separator);
  const right = id.slice(separator + 1);
  return isDotAtomText(left) && (isDotAtomText(right) || isNoFoldLiteral(right));
};

/**
 * Normalizes a domain for {@link generateMessageId}.
 *
 * @param domain The domain to normalize.
 * @returns The domain, converted to its ASCII form when it is a DNS name
 *          written in a non-Latin script.
 * @throws {TypeError} If the domain is not a valid identifier right-hand side.
 */
const normalizeIdRight = (domain) => {
  if (typeof domain !== 'string' || !isIdRight(domain)) {
    throw new TypeError(`Invalid message ID domain: ${JSON.stringify(domain)}`);
  }
  if (!hasNonAscii(domain) || !dnsNamePattern.test(domain)) return domain;
  // `URL` applies IDNA, which is the only Punycode implementation available on
  // every runtime Upyo targets.  It is used for the conversion alone; the
  // value has already been validated, and the result is validated again.
  let url;
  try {
    url = new URL(`http://${domain}/`);
  } catch {
    return domain;
  }
  const ascii = url.hostname;
  return url.host === ascii && url.pathname === '/' && isIdRight(ascii) ? ascii : domain;
};

/**
 * The shape a domain has to have before {@link normalizeIdRight} hands it to
 * `URL` for IDNA conversion.  Anything else, such as an address literal or a
 * dot-atom using punctuation `URL` would read as a delimiter, is left alone,
 * since the conversion would silently truncate it.  Combining marks are
 * allowed: a decomposed spelling is as much a DNS name as its precomposed
 * equivalent, and IDNA normalizes the two to the same label.
 */
const dnsNamePattern = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}\-.]*$/u;

/**
 * Tells whether a value is a valid `id-right`.
 *
 * @param value The value to check.
 * @returns Whether the value is a valid `id-right`.
 */
const isIdRight = (value) => {
  return isDotAtomText(value) || isNoFoldLiteral(value);
};

/**
 * Tells whether a value is a `dot-atom-text`: one or more `atext` runs joined
 * by single dots, so neither a leading, a trailing, nor a doubled dot.
 *
 * @param value The value to check.
 * @returns Whether the value is a `dot-atom-text`.
 */
const isDotAtomText = (value) => {
  if (value === '') return false;
  for (const atom of value.split('.')) {
    if (atom === '') return false;
    for (const character of atom) {
      if (!isAtext(character)) return false;
    }
  }
  return true;
};

/**
 * Tells whether a value is a `no-fold-literal`: an address literal such as
 * `[192.0.2.1]`.
 *
 * An empty literal is rejected, which RFC 5322 would allow: it identifies
 * nothing, and a generator that produces one is more likely broken than
 * deliberate.
 *
 * @param value The value to check.
 * @returns Whether the value is a `no-fold-literal`.
 */
const isNoFoldLiteral = (value) => {
  if (value.length < 3 || !value.startsWith('[') || !value.endsWith(']')) {
    return false;
  }
  for (const character of value.slice(1, -1)) {
    if (!isDtext(character)) return false;
  }
  return true;
};

/**
 * The ASCII punctuation RFC 5322 allows in an atom, besides letters and digits.
 */
const asciiAtextSymbols = "!#$%&'*+-/=?^_`{|}~";

/**
 * Tells whether a character is `atext`, the character class an atom is built
 * from, extended with UTF-8 by RFC 6532.
 *
 * @param character A single character, which may be a surrogate pair.
 * @returns Whether the character is `atext`.
 */
const isAtext = (character) => {
  const codePoint = character.codePointAt(0);
  if (codePoint == null) return false;
  if (codePoint > 0x7f) return isNonAsciiText(codePoint);
  return /[A-Za-z0-9]/.test(character) || asciiAtextSymbols.includes(character);
};

/**
 * Tells whether a character is `dtext`, the character class the inside of an
 * address literal is built from, extended with UTF-8 by RFC 6532.
 *
 * Angle brackets are excluded although RFC 5322 permits them here.  They are
 * unambiguous only to a parser that tracks the literal, and an identifier
 * carrying one would be truncated by every reader that simply looks for the
 * closing bracket of the field.
 *
 * @param character A single character, which may be a surrogate pair.
 * @returns Whether the character is `dtext`.
 */
const isDtext = (character) => {
  const codePoint = character.codePointAt(0);
  if (codePoint == null) return false;
  if (codePoint > 0x7f) return isNonAsciiText(codePoint);
  return (
    ((codePoint >= 0x21 && codePoint <= 0x5a) || (codePoint >= 0x5e && codePoint <= 0x7e)) &&
    character !== '<' &&
    character !== '>'
  );
};

/**
 * Tells whether a code point beyond ASCII may appear in a header field under
 * RFC 6532.  An unpaired surrogate may not: it cannot be encoded as UTF-8.
 *
 * @param codePoint The code point to check.
 * @returns Whether the code point is usable.
 */
const isNonAsciiText = (codePoint) => {
  return codePoint < 0xd800 || codePoint > 0xdfff;
};

/**
 * Tells whether a value contains a character beyond ASCII.
 *
 * @param value The value to check.
 * @returns Whether the value contains a character beyond ASCII.
 */
const hasNonAscii = (value) => {
  return !/^[\x20-\x7E]*$/.test(value);
};

/**
 * Works out the reply threading header fields a transport should write for a
 * message, from {@link Message.inReplyTo} and {@link Message.references}.
 *
 * The three states those fields can be in map onto the result like this:
 *
 *  -  A field the message leaves unset is absent from the map.  The message
 *     does not own the header, so a transport may still write one supplied
 *     through {@link Message.headers}.
 *  -  A field set to an empty list maps to `null`.  The message owns the
 *     header and deliberately writes nothing, which suppresses a custom header
 *     of the same name.
 *  -  A field with identifiers in it maps to the formatted field value.
 *
 * Keys are the canonical field names, `In-Reply-To` and `References`.  A header
 * field name is case insensitive, so compare accordingly when deciding whether
 * a custom header is shadowed.
 *
 * @example
 * ```ts
 * import { resolveThreadingHeaders } from "@alexify/mailer";
 * // for a message replying to <122@example.com>:
 * // Map { "In-Reply-To" => "<122@example.com>" }
 * ```
 *
 * @param message The message being converted.
 * @returns The header fields the message owns, keyed by canonical name.
 * @throws {TypeError} If the message carries an invalid identifier.
 */
const resolveThreadingHeaders = (message) => {
  const resolved = new Map();
  const fields = [
    ['In-Reply-To', message.inReplyTo],
    ['References', message.references],
  ];
  for (const [name, ids] of fields) {
    if (ids == null) continue;
    resolved.set(name, ids.length < 1 ? null : ids.map(formatMessageId).join(' '));
  }
  return resolved;
};

/**
 * Generates an identifier rooted in the sender's domain.
 *
 * `parseAddress()` accepts spellings the identifier grammar does not, such as
 * the trailing dot of a fully qualified name, which is dropped here.  A domain
 * the grammar still refuses falls back to `localhost` rather than failing the
 * send.  Uniqueness holds either way: the left half is a UUID.
 *
 * @param address The sender's address.
 * @returns A bare message identifier.
 * @internal
 */
const generateSenderMessageId = (address) => {
  const domain = domainOf(address).replace(/\.$/, '');
  try {
    return generateMessageId(domain);
  } catch {
    return generateMessageId('localhost');
  }
};

/**
 * Extracts the domain of an address.
 *
 * The separator is the first at sign outside a quoted local part, since a
 * quoted one may contain at signs of its own, as in `"a@b"@example.com`.
 *
 * @param address The address to read.
 * @returns The domain, or the whole address when it carries no separator.
 */
const domainOf = (address) => {
  let quoted = false;
  for (let index = 0; index < address.length; index++) {
    const character = address[index];
    if (quoted && character === '\\') index++;
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === '@') return address.slice(index + 1);
  }
  return address;
};

// The copies of messages pinned to one Message-ID, keyed weakly: a copy lives
// as long as the caller's message does.
const pinnedMessages = new WeakMap();

/**
 * Gives a message one Message-ID for all of its attempts.  `./retry` and
 * `./pool` send the same message more than once; without a fixed identifier
 * each attempt would compose a new one, and a message delivered twice after
 * an ambiguous failure would not read as one to its recipients' servers.
 *
 * @param message The message to send.
 * @returns The message itself when it has a Message-ID, either as
 * `messageId` or as a custom header; otherwise a copy carrying a generated
 * one, the same copy on every call for the same message.
 * @internal
 */
const pinMessageId = (message) => {
  if (typeof message !== 'object' || message === null || message.sender == null) return message;
  if (message.messageId !== undefined || message.headers?.get('Message-ID') != null) {
    return message;
  }
  let pinned = pinnedMessages.get(message);
  if (pinned === undefined) {
    pinned = { ...message, messageId: generateSenderMessageId(message.sender.address) };
    pinnedMessages.set(message, pinned);
  }
  return pinned;
};

module.exports = {
  generateMessageId,
  generateSenderMessageId,
  parseMessageId,
  pinMessageId,
  formatMessageId,
  resolveThreadingHeaders,
};
