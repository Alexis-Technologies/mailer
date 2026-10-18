// Not ported: the identifiers the library generates, from a generator
// the application may pass in (cuid2, ulid, nanoid, ...) to correlate them with
// its own records, checked before they reach a header field or a request.

const { isDotAtomText } = require('./text.js');

const MAX_ID_LENGTH = 256;

/**
 * The generator used when none is passed in: a random UUID for every kind.
 *
 * @returns A random UUID.
 * @internal
 */
const defaultIdGenerator = () => crypto.randomUUID();

const isPrintableAscii = (value) => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
};

/**
 * Generates an identifier of a kind and checks it.  The left part of a
 * Message-ID or a Content-ID must be dot-atom-text (RFC 5322 §3.2.3), and
 * every kind printable ASCII without spaces, at most 256 characters: a value
 * with a line break or an angle bracket would end the field it goes into.
 *
 * @param kind `message-id`, `content-id`, `idempotency-key` or `receipt-id`.
 * @param generator The generator of the application, or the default one.
 * @returns The identifier.
 * @throws {TypeError} If the generator returns anything else.
 * @internal
 */
const generateId = (kind, generator = defaultIdGenerator) => {
  const value = generator(kind);
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    !isPrintableAscii(value) ||
    ((kind === 'message-id' || kind === 'content-id') && !isDotAtomText(value))
  ) {
    throw new TypeError(
      `Invalid ${kind} from generateId: ${JSON.stringify(String(value).slice(0, 100))}.`,
    );
  }
  return value;
};

module.exports = { defaultIdGenerator, generateId };
