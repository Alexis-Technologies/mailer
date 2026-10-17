// Ported from upyo v0.7.0 (packages/mime/src/message.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// Also ported from nodemailer v10.0.16 (src/mime-node/index.ts): the case of
// a custom field name, `_normalizeHeaderKey`.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman

const { Buffer } = require('node:buffer');
const { formatPhrase, toAsciiAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { checkAttachment } = require('../core/message.js');
const {
  formatMessageId,
  generateSenderMessageId,
  resolveThreadingHeaders,
} = require('../core/message-id.js');
const { resolveCalendarContent } = require('../core/calendar.js');
const { createLog } = require('../internal/log.js');
const { checkDkimConfig } = require('./dkim/types.js');
const { resolvePrivateKey } = require('./dkim/sign.js');
const { attachmentEncodedSize, encodeAttachment } = require('./mime-stream.js');
const { base64, hasLineLongerThan, utf8 } = require('./bytes.js');

/**
 * Freezes message metadata without reading attachment content.
 * @param message Message whose metadata will be frozen.
 * @param dkimConfig Optional signing configuration.
 * @returns A deterministic MIME plan for one send attempt.
 * @throws {RangeError} If a header cannot fit the RFC 5322 line limit.
 * @throws {TypeError} If the message carries an invalid message identifier or
 * date, an address or identity header containing a carriage return or line
 * feed, or an invalid custom header field name.
 */
const prepareMimeMessage = (message, dkimConfig, options = {}) => {
  // Observe every promise before validation can throw or an earlier reader stalls.
  for (const attachment of message.attachments) {
    if (attachment.content instanceof Promise) {
      attachment.content.catch(() => {});
    }
  }
  // Checked before a key import is started for it.
  if (dkimConfig != null) checkDkimConfig(dkimConfig);
  const dkim =
    dkimConfig == null
      ? undefined
      : { ...dkimConfig, signatures: resolveSignatures(dkimConfig.signatures) };
  const parts = buildMimeParts(message, options.generateId);
  const first = parts[0];
  if (typeof first !== 'string') throw new TypeError('Missing MIME headers.');
  const separator = first.indexOf('\r\n\r\n') + 4;
  const headers = first.slice(0, separator);
  parts[0] = first.slice(separator);

  const encoding = hasNonAsciiText(headers, parts) ? 'utf8' : '7bit';
  return {
    encoding,
    dkim,
    // Where a signing failure under send-unsigned is told.
    log: createLog(options.logger, { component: 'dkim' }),
    headers,
    async *body(signal, progress) {
      for (const part of parts) {
        signal?.throwIfAborted();
        if (typeof part === 'string') {
          const bytes = utf8(part);
          for (let offset = 0; offset < bytes.length; offset += 65536) {
            signal?.throwIfAborted();
            yield bytes.subarray(offset, offset + 65536);
          }
        } else {
          yield* encodeAttachment(part.content, signal, progress);
        }
      }
    },
    async size(signal, checkSize) {
      let size = Buffer.byteLength(headers);
      let unknown = false;
      for (const part of parts) {
        signal?.throwIfAborted();
        if (typeof part === 'string') size += Buffer.byteLength(part);
        else {
          if (part.content instanceof Promise) {
            part.content = await readAttachmentContent(part.content, signal);
          }
          if (typeof part.content === 'function') unknown = true;
          else {
            size += attachmentEncodedSize(
              part.content instanceof Uint8Array ? part.content.byteLength : part.content.size,
            );
          }
        }
        if (!Number.isSafeInteger(size)) {
          throw new RangeError('Message size exceeds the safe integer range.');
        }
      }
      checkSize?.(size);
      return unknown ? undefined : size;
    },
  };
};

// The signatures of a DKIM configuration with their keys imported, once per
// signature configuration of the caller, and their field lists copied.
const resolveSignatures = (signatures) => {
  const resolved = [];
  for (const signature of signatures) {
    resolved.push({
      ...signature,
      privateKey: resolvePrivateKey(signature),
      headerFields: signature.headerFields == null ? undefined : [...signature.headerFields],
    });
  }
  return resolved;
};

// Names written by pushHeaderFields, plus Cc and Reply-To even when the
// message carries no such recipients: a custom header there would list
// addresses the envelope never receives.  The identity and threading names are
// here unconditionally too, even when nothing was written: each of them has had
// its one chance to be emitted, from the typed field or from the very custom
// header that would otherwise be written again.
const COMPOSED_HEADERS = new Set([
  'from',
  'to',
  'cc',
  'reply-to',
  'subject',
  'date',
  'message-id',
  'in-reply-to',
  'references',
]);
const PRIORITY_HEADERS = new Set(['x-priority', 'x-msmail-priority']);
const THREADING_FIELDS = ['In-Reply-To', 'References'];

const buildMimeParts = (message, generateId) => {
  const lines = [];
  const alternatives = buildAlternatives(message);
  pushHeaderFields(lines, message, generateId);
  lines.push('MIME-Version: 1.0');
  // RFC 2387: an inline part goes with the body it is shown in, in a
  // multipart/related; the files go beside them in a multipart/mixed.
  const inline = [];
  const attached = [];
  for (const attachment of message.attachments) {
    if (attachment.inline) inline.push(attachment);
    else attached.push(attachment);
  }
  if (attached.length > 0) {
    const boundary = pushMultipartHeader(lines, 'multipart/mixed');
    lines.push(`--${boundary}`);
    if (inline.length > 0) pushRelated(lines, alternatives, inline);
    else pushBody(lines, alternatives);
    for (const attachment of attached) pushAttachment(lines, attachment, boundary);
    lines.push('');
    lines.push(`--${boundary}--`);
  } else if (inline.length > 0) {
    pushRelated(lines, alternatives, inline, true);
  } else if (alternatives.length > 1) {
    const boundary = pushMultipartHeader(lines, 'multipart/mixed');
    lines.push(`--${boundary}`);
    pushAlternatives(lines, alternatives);
    lines.push('');
    lines.push(`--${boundary}--`);
  } else {
    pushSinglePart(lines, alternatives[0]);
  }
  return joinLines(lines);
};

// The Content-Type of a top-level multipart and its preamble.
const pushMultipartHeader = (lines, type, parameters = '') => {
  const boundary = generateBoundary();
  lines.push(`Content-Type: ${type}; boundary="${boundary}"${parameters}`);
  lines.push('');
  lines.push('This is a multi-part message in MIME format.');
  lines.push('');
  return boundary;
};

const pushBody = (lines, alternatives) => {
  if (alternatives.length > 1) pushAlternatives(lines, alternatives);
  else pushSinglePart(lines, alternatives[0]);
};

// A multipart/related of the body and its inline parts; `type` names the root
// part, the body (RFC 2387 §3.1).
const pushRelated = (lines, alternatives, inline, top = false) => {
  const root = alternatives.length > 1 ? 'multipart/alternative' : mediaType(alternatives[0]);
  const parameters = `; type="${root}"`;
  let boundary;
  if (top) {
    boundary = pushMultipartHeader(lines, 'multipart/related', parameters);
  } else {
    boundary = generateBoundary();
    lines.push(`Content-Type: multipart/related; boundary="${boundary}"${parameters}`);
    lines.push('');
  }
  lines.push(`--${boundary}`);
  pushBody(lines, alternatives);
  for (const attachment of inline) pushAttachment(lines, attachment, boundary);
  lines.push('');
  lines.push(`--${boundary}--`);
};

const mediaType = (alternative) => {
  const end = alternative.contentType.indexOf(';');
  return end === -1 ? alternative.contentType : alternative.contentType.slice(0, end);
};

const pushHeaderFields = (lines, message, generateId) => {
  lines.push(foldHeader('From', encodeAddress(message.sender)));
  lines.push(foldHeader('To', encodeAddressList(message.recipients)));
  if (message.ccRecipients.length > 0) {
    lines.push(foldHeader('Cc', encodeAddressList(message.ccRecipients)));
  }
  if (message.replyRecipients.length > 0) {
    lines.push(foldHeader('Reply-To', encodeAddressList(message.replyRecipients)));
  }
  lines.push(foldHeader('Subject', encodeHeaderValue(message.subject, true)));

  // The identity and threading fields all carry structured values, so they are
  // written verbatim rather than RFC 2047 encoded.
  lines.push(foldHeader('Date', resolveDate(message)));
  lines.push(foldHeader('Message-ID', resolveMessageId(message, generateId)));
  const threading = resolveThreadingHeaders(message);
  for (const name of THREADING_FIELDS) {
    // A field the message does not own falls back to a custom header, one it
    // owns but left empty writes nothing at all.
    const owned = threading.get(name);
    const value = owned === undefined ? overridden(message, name) : owned;
    if (value != null) lines.push(foldHeader(name, value));
  }

  const hasPriority = message.priority !== 'normal';
  if (hasPriority) {
    const high = message.priority === 'high';
    lines.push(`X-Priority: ${high ? '1' : '5'}`);
    lines.push(`X-MSMail-Priority: ${high ? 'High' : 'Low'}`);
  }

  for (const [key, value] of message.headers) {
    const name = key.toLowerCase();
    if (COMPOSED_HEADERS.has(name) || reservedHeaders.has(name)) continue;
    if (hasPriority && PRIORITY_HEADERS.has(name)) continue;
    lines.push(foldHeader(canonicalHeaderName(name), encodeHeaderValue(value)));
  }
};

// Each word of a field name capitalized, as nodemailer writes it, the
// abbreviations its readers know upper-cased: `Headers` keeps names in lower
// case, and `list-unsubscribe-post` reads as a field nobody named.
const UPPER_CASE_PARTS =
  /^x-smtpapi$|^(?:mime|dkim|arc|bimi)\b|^[a-z]|-(?:spf|fbl|id|md5)$|-[a-z]/g;
const canonicalHeaderName = (name) =>
  name === 'content-features'
    ? 'Content-features'
    : name.replace(UPPER_CASE_PARTS, (part) => part.toUpperCase());

const encodeAddressList = (addresses) => {
  let list = '';
  for (let i = 0; i < addresses.length; i++) {
    list += i === 0 ? encodeAddress(addresses[i]) : `, ${encodeAddress(addresses[i])}`;
  }
  return list;
};

const pushSinglePart = (lines, alternative) => {
  lines.push(`Content-Type: ${alternative.contentType}`);
  lines.push(`Content-Transfer-Encoding: ${alternative.encoding}`);
  lines.push('');
  lines.push(alternative.body);
};

const pushAlternatives = (lines, alternatives) => {
  const boundary = generateBoundary();
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  lines.push('');
  for (const alternative of alternatives) {
    lines.push(`--${boundary}`);
    pushSinglePart(lines, alternative);
    lines.push('');
  }
  lines.push(`--${boundary}--`);
};

// A message is structural input, not only one built by createMessage(), so the
// fields written into part headers as given are checked again here, as the
// addresses and the custom headers are.
const pushAttachment = (lines, attachment, boundary) => {
  checkAttachment(attachment);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push(
    foldHeader(
      'Content-Type',
      `${attachment.contentType}; ${encodeMimeParameter('name', attachment.filename)}`,
    ),
  );
  lines.push('Content-Transfer-Encoding: base64');
  const disposition = attachment.inline ? 'inline' : 'attachment';
  lines.push(
    foldHeader(
      'Content-Disposition',
      `${disposition}; ${encodeMimeParameter('filename', attachment.filename)}`,
    ),
  );
  if (attachment.inline) lines.push(foldHeader('Content-ID', `<${attachment.contentId}>`));
  lines.push('');
  lines.push({ content: attachment.content });
};

// The lines as text, each ended by CRLF, split around the attachment contents.
const joinLines = (lines) => {
  const parts = [];
  let text = '';
  for (const line of lines) {
    if (typeof line === 'string') text += line;
    else {
      parts.push(text, line);
      text = '';
    }
    text += '\r\n';
  }
  parts.push(text);
  return parts;
};

/**
 * Collects the body alternatives of a message, least preferred first.
 *
 * RFC 2046 §5.1.4 orders a `multipart/alternative` by increasing richness, so a
 * client picks the last one it understands.  Plain text comes first, then HTML,
 * then the calendar object: a client that schedules should act on the
 * invitation rather than render the prose describing it.
 *
 * The presence of a body is tested with `in` rather than truthiness, so an
 * empty string a caller supplied deliberately still produces its part.
 *
 * @param message The message being composed.
 * @returns At least one alternative, in the order they are written.
 * @throws {TypeError} If the calendar content is not valid.
 */
const buildAlternatives = (message) => {
  const alternatives = [];

  if ('text' in message.content && message.content.text !== undefined) {
    alternatives.push({
      contentType: 'text/plain; charset=utf-8',
      encoding: 'quoted-printable',
      body: encodeQuotedPrintable(message.content.text),
    });
  }

  if ('html' in message.content) {
    alternatives.push({
      contentType: 'text/html; charset=utf-8',
      encoding: 'quoted-printable',
      body: encodeQuotedPrintable(message.content.html),
    });
  }

  if (message.calendar != null) {
    // Re-validated here rather than trusted from the message: `Message` is a
    // structural interface, and the method is written into a `Content-Type`
    // parameter, the same reason `formatMessageId()` checks again below.
    const calendar = resolveCalendarContent(message.calendar);
    alternatives.push({
      // The parameter repeats the object's own METHOD property, which RFC 6047
      // §2.4 requires.  Base64 keeps the CRLF structure RFC 5545 §3.1 makes
      // normative intact, which quoted-printable would not.
      contentType: `text/calendar; charset=utf-8; method=${calendar.method}`,
      encoding: 'base64',
      body: encodeBase64Body(calendar.content),
    });
  }

  if (alternatives.length < 1) {
    alternatives.push({
      contentType: 'text/plain; charset=utf-8',
      encoding: 'quoted-printable',
      body: '',
    });
  }

  return alternatives;
};

/**
 * Encodes a body as Base64, wrapped at the 76 columns RFC 2045 §6.8 allows.
 *
 * The result carries no trailing CRLF, because MIME assembly appends one to
 * every line it writes.
 *
 * @param text The body to encode.
 * @returns The wrapped Base64 payload.
 */
const encodeBase64Body = (text) => {
  const encoded = base64(utf8(text));
  const lines = [];
  for (let offset = 0; offset < encoded.length; offset += 76) {
    lines.push(encoded.slice(offset, offset + 76));
  }
  return lines.join('\r\n');
};

/**
 * Reads a header field that overrides a generated default.
 *
 * Unlike custom headers, the value is written verbatim rather than RFC 2047
 * encoded, so it cannot rely on `encodeHeaderValue()` to neutralize control
 * characters.  `ImmutableHeaders` is a structural type, so a `Message` may
 * carry an adapter that never rejected CR or LF the way a platform `Headers`
 * does.
 *
 * @param message The message whose headers are read.
 * @param name The header field name.
 * @returns The supplied value, or `undefined` when the message has none.
 * @throws {TypeError} If the value contains a carriage return or line feed,
 * which would inject additional header fields into the message.
 */
const overridden = (message, name) => {
  const value = message.headers.get(name);
  if (value == null) return undefined;
  if (/[\r\n]/.test(value)) {
    throw new TypeError(`Header field ${name} must not contain a carriage return or line feed.`);
  }
  return value;
};

/**
 * Header fields the composer owns but writes after the custom headers, or
 * deliberately omits.  A custom header with one of these names is dropped
 * rather than appended: the structured `Message` fields are authoritative,
 * RFC 5322 §3.6 allows at most one of each, and a duplicate placed before the
 * composer's own field makes parsers that take the first occurrence read the
 * wrong value.
 */
const reservedHeaders = new Set([
  // Bcc recipients travel in the SMTP envelope only, so a Bcc header would
  // disclose them to every recipient.
  'bcc',
  'content-transfer-encoding',
  'content-type',
  'mime-version',
]);

/**
 * Tells whether a value contains a character outside ASCII, which a message
 * can only carry with the SMTPUTF8 extension (RFC 6531).
 *
 * @param value The value to check.
 * @returns Whether the value contains a character outside ASCII.
 */
const hasNonAscii = (value) => {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x7f) return true;
  }
  return false;
};

const hasNonAsciiText = (headers, parts) => {
  if (hasNonAscii(headers)) return true;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (typeof part === 'string' && hasNonAscii(part)) return true;
  }
  return false;
};

// A boundary must not occur in the parts it separates, which nothing checks,
// so it is unguessable rather than derived from the clock and Math.random.
const generateBoundary = () => {
  return `boundary-${crypto.randomUUID()}`;
};

/**
 * Resolves the origination date: the typed field, then a custom header, then
 * the time of conversion.
 *
 * @param message The message being composed.
 * @returns The `Date` field value.
 * @throws {TypeError} If the message carries an invalid date, or a custom
 * `Date` header containing a carriage return or line feed.
 */
const resolveDate = (message) => {
  return message.date === undefined
    ? (overridden(message, 'Date') ?? formatDate(new Date()))
    : formatDate(message.date);
};

/**
 * Resolves the message identifier: the typed field, then a custom header, then
 * one generated within the sender's domain.
 *
 * @param message The message being composed.
 * @returns The `Message-ID` field value, enclosed in angle brackets.
 * @throws {TypeError} If the message carries an invalid identifier, or a custom
 * `Message-ID` header containing a carriage return or line feed.
 */
const resolveMessageId = (message, generateId) => {
  if (message.messageId !== undefined) {
    return formatMessageId(message.messageId);
  }
  const custom = overridden(message, 'Message-ID');
  if (custom != null) return custom;
  return formatMessageId(generateSenderMessageId(message.sender.address, generateId));
};

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const pad = (value) => value.toString().padStart(2, '0');

/**
 * Formats a date as an RFC 5322 §3.3 `date-time` in UTC.
 *
 * `Date.toUTCString()` is close but ends in the obsolete `GMT` zone rather than
 * the numeric `+0000` the current grammar asks for.
 *
 * @param date The date to format.
 * @returns The formatted date.
 * @throws {TypeError} If the date is invalid, or earlier than the grammar can
 * express.
 */
const formatDate = (date) => {
  const time = date instanceof Date ? date.getTime() : Number.NaN;
  const year = Number.isNaN(time) ? Number.NaN : date.getUTCFullYear();
  if (Number.isNaN(time) || year < 1900) {
    throw new TypeError(`Invalid date: ${JSON.stringify(date)}`);
  }
  return (
    `${dayNames[date.getUTCDay()]}, ${pad(date.getUTCDate())} ` +
    `${monthNames[date.getUTCMonth()]} ${year.toString().padStart(4, '0')} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} +0000`
  );
};

const encodeAddress = (address) => {
  if (/[\r\n]/.test(address.address)) {
    throw new TypeError('Address must not contain a carriage return or line feed.');
  }
  const email = toAsciiAddress(address.address);
  if (address.name == null) {
    // No display name, just return the email address
    return email;
  }

  // Encode only the display name part, leave email address as-is.  An
  // encoded word holds no specials, but plain text that is more than atoms is
  // quoted, or "<", "," and "@" in it would make another mailbox.
  const encodedDisplayName = encodeHeaderValue(address.name, true);
  const displayName =
    encodedDisplayName === address.name ? formatPhrase(address.name) : encodedDisplayName;
  return `${displayName} <${email}>`;
};

// Whether a word of the value, between whitespace, is longer than `limit`.
const hasWordLongerThan = (value, limit) => {
  let run = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isSpace = code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    run = isSpace ? 0 : run + 1;
    if (run > limit) return true;
  }
  return false;
};

// An encoded word holds at most 45 bytes of text: `=?UTF-8?B?` and `?=` take
// 12 of its 75 characters, and 45 bytes are 60 in base64.
const MAX_ENCODED_WORD_BYTES = 45;

const encodeWord = (text) => `=?UTF-8?B?${base64(utf8(text))}?=`;

const encodeHeaderValue = (value, encodeLongAsciiWords = false) => {
  // RFC 2047 encoding for non-ASCII characters in headers
  const isPrintableAscii = /^[\x20-\x7E]*$/.test(value);
  if (isPrintableAscii && !(encodeLongAsciiWords && hasWordLongerThan(value, 60))) {
    return value;
  }

  // Each word takes as many whole characters as fit, counted by their UTF-8
  // length: upstream encoded the growing word again for every character.
  const words = [];
  let wordStart = 0;
  let wordBytes = 0;
  for (let i = 0; i < value.length;) {
    const codePoint = value.codePointAt(i);
    const characterLength = codePoint > 0xffff ? 2 : 1;
    const characterBytes = utf8Length(codePoint);
    if (wordBytes + characterBytes > MAX_ENCODED_WORD_BYTES) {
      words.push(encodeWord(value.slice(wordStart, i)));
      wordStart = i;
      wordBytes = 0;
    }
    wordBytes += characterBytes;
    i += characterLength;
  }
  if (wordStart < value.length) words.push(encodeWord(value.slice(wordStart)));
  return words.join(' ');
};

const utf8Length = (codePoint) => {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
};

// Each byte as an RFC 2231 extended value carries it: an attribute-char as it
// is, any other byte percent-encoded.
const EXTENDED_VALUE_BYTES = [];
for (let byte = 0; byte < 256; byte++) {
  const character = String.fromCharCode(byte);
  EXTENDED_VALUE_BYTES.push(
    /^[A-Za-z0-9!#$&+.^_`|~-]$/.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

const formatParameterSegment = (name, index, segment) =>
  index === 0 ? `${name}*0*=UTF-8''${segment}` : `; ${name}*${index}*=${segment}`;

const encodeMimeParameter = (name, value) => {
  const escapedValue = value.replace(/[\\"]/g, '\\$&');
  const quotedParameter = `${name}="${escapedValue}"`;
  if (/^[\x20-\x7E]*$/.test(value) && quotedParameter.length <= 60) {
    return quotedParameter;
  }

  // Continuations of at most 45 characters each, built in one pass over the
  // UTF-8 bytes of the value.
  const bytes = Buffer.from(value, 'utf8');
  let parameter = '';
  let segment = '';
  let index = 0;
  for (let i = 0; i < bytes.length; i++) {
    const encodedByte = EXTENDED_VALUE_BYTES[bytes[i]];
    if (segment.length + encodedByte.length > 45) {
      parameter += formatParameterSegment(name, index++, segment);
      segment = '';
    }
    segment += encodedByte;
  }
  if (segment.length > 0 || index === 0) parameter += formatParameterSegment(name, index, segment);
  return parameter;
};

const foldHeader = (name, value) => {
  if (!/^[\x21-\x39\x3b-\x7e]+$/.test(name)) {
    throw new TypeError(
      'Header field name must contain printable ASCII characters other than colon.',
    );
  }
  // RFC 2047 §2 holds a line with an encoded word to 76 characters.
  const hasEncodedWords = value.includes('=?');
  const recommendedLineLength = hasEncodedWords ? MAX_ENCODED_LINE_LENGTH : 78;
  const lines = [];
  let prefix = `${name}: `;
  let remaining = hasEncodedWords ? fitFirstEncodedWord(prefix, value) : value;
  if (remaining === undefined) {
    // A field name too long to leave room for any encoded text after it.
    lines.push(`${name}:`);
    prefix = ' ';
    remaining = value;
  }

  while (prefix.length + remaining.length > recommendedLineLength) {
    const availableLength = recommendedLineLength - prefix.length;
    let breakIndex = -1;

    for (let index = Math.min(availableLength, remaining.length - 1); index >= 0; index--) {
      if (remaining[index] === ' ' || remaining[index] === '\t') {
        breakIndex = index;
        break;
      }
    }

    if (breakIndex < 0) {
      for (let index = Math.max(availableLength + 1, 0); index < remaining.length; index++) {
        if (remaining[index] === ' ' || remaining[index] === '\t') {
          breakIndex = index;
          break;
        }
      }
    }

    if (breakIndex < 0) break;

    let whitespaceEnd = breakIndex + 1;
    while (
      whitespaceEnd < remaining.length &&
      (remaining[whitespaceEnd] === ' ' || remaining[whitespaceEnd] === '\t')
    ) {
      whitespaceEnd++;
    }

    if (whitespaceEnd === remaining.length) break;

    lines.push(prefix + remaining.slice(0, breakIndex));
    prefix = remaining.slice(breakIndex, whitespaceEnd);
    remaining = remaining.slice(whitespaceEnd);
  }

  lines.push(prefix + remaining);
  const folded = lines.join('\r\n');
  if (hasLineLongerThan(folded, 998)) {
    throw new RangeError(`Header field ${name} contains a token too long to fold.`);
  }
  return folded;
};

const MAX_ENCODED_LINE_LENGTH = 76;
const ENCODED_WORD = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=$/;

/**
 * Splits the encoded word a value starts with when it would not fit on the
 * first line after the field name, so that the first line keeps text and
 * stays within 76 characters; the rest of the word folds to the next line.
 * Adjacent encoded words decode as one text (RFC 2047 §6.2).
 *
 * @param prefix The field name with its colon and space.
 * @param value The encoded value.
 * @returns The value, with its first word split if it had to be, or
 * `undefined` when not even one character fits after the field name.
 */
const fitFirstEncodedWord = (prefix, value) => {
  const space = value.indexOf(' ');
  const end = space === -1 ? value.length : space;
  const match = ENCODED_WORD.exec(value.slice(0, end));
  if (match === null || prefix.length + end <= MAX_ENCODED_LINE_LENGTH) return value;
  const bytes = Buffer.from(match[1], 'base64');
  // 12 characters of `=?UTF-8?B?` and `?=`, then 4 of base64 per 3 bytes.
  let cut = Math.floor((MAX_ENCODED_LINE_LENGTH - prefix.length - 12) / 4) * 3;
  // A UTF-8 character is not split: a continuation byte moves the cut back.
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
  if (cut <= 0) return undefined;
  const first = `=?UTF-8?B?${base64(bytes.subarray(0, cut))}?=`;
  const rest = `=?UTF-8?B?${base64(bytes.subarray(cut))}?=`;
  return `${first} ${rest}${value.slice(end)}`;
};

// The digits of an escaped byte, as character codes.
const HEX_DIGITS = Buffer.from('0123456789ABCDEF', 'latin1');

/**
 * Encodes text as quoted-printable (RFC 2045 §6.7), written byte by byte into
 * one buffer: upstream concatenated a string per byte and formatted every
 * escape with toString(16).
 */
const encodeQuotedPrintable = (text) => {
  const bytes = utf8(text);
  // At most three characters per byte, and a soft line break of three per
  // 25 escaped bytes.
  const output = Buffer.allocUnsafe(bytes.length * 3 + Math.ceil(bytes.length / 25) * 3 + 3);
  let written = 0;
  let column = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 13 && bytes[i + 1] === 10) {
      output[written++] = 13;
      output[written++] = 10;
      column = 0;
      i++;
      continue;
    }
    const escaped =
      byte < 32 ||
      byte > 126 ||
      byte === 61 ||
      (byte === 32 && (i + 1 === bytes.length || bytes[i + 1] === 13 || bytes[i + 1] === 10)) ||
      (byte === 46 && column === 0);
    const width = escaped ? 3 : 1;
    if (column + width > 75) {
      output[written++] = 61;
      output[written++] = 13;
      output[written++] = 10;
      column = 0;
    }
    if (escaped) {
      output[written++] = 61;
      output[written++] = HEX_DIGITS[byte >> 4];
      output[written++] = HEX_DIGITS[byte & 15];
    } else {
      output[written++] = byte;
    }
    column += width;
  }
  return output.toString('latin1', 0, written);
};

module.exports = { prepareMimeMessage };
