// Ported from upyo v0.7.0 (packages/mime/src/message.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { Buffer } = require('node:buffer');
const { formatPhrase } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { checkAttachment } = require('../core/message.js');
const {
  formatMessageId,
  generateSenderMessageId,
  resolveThreadingHeaders,
} = require('../core/message-id.js');
const { resolveCalendarContent } = require('../core/calendar.js');
const { validateDkimBodyMode } = require('./dkim/types.js');
const { attachmentEncodedSize, encodeAttachment } = require('./mime-stream.js');
const { base64, utf8 } = require('./bytes.js');

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
const prepareMimeMessage = (message, dkimConfig) => {
  // Observe every promise before validation can throw or an earlier reader stalls.
  for (const attachment of message.attachments) {
    if (attachment.content instanceof Promise) {
      attachment.content.catch(() => {});
    }
  }
  const dkim =
    dkimConfig == null
      ? undefined
      : {
          ...dkimConfig,
          signatures: dkimConfig.signatures.map((signature) => ({
            ...signature,
            headerFields: signature.headerFields == null ? undefined : [...signature.headerFields],
          })),
        };
  if (dkim != null) validateDkimBodyMode(dkim);
  const parts = buildMimeParts(message);
  const first = parts[0];
  if (typeof first !== 'string') throw new TypeError('Missing MIME headers.');
  const separator = first.indexOf('\r\n\r\n') + 4;
  const headers = first.slice(0, separator);
  parts[0] = first.slice(separator);

  const encoding = [headers, ...parts.filter((part) => typeof part === 'string')].some(hasNonAscii)
    ? 'utf8'
    : '7bit';
  return {
    encoding,
    dkim,
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
      let size = utf8(headers).length;
      let unknown = false;
      for (const part of parts) {
        signal?.throwIfAborted();
        if (typeof part === 'string') size += utf8(part).length;
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

const buildMimeParts = (message) => {
  const lines = [];
  const boundary = generateBoundary();
  const hasAttachments = message.attachments.length > 0;
  const alternatives = buildAlternatives(message);
  const isMultipart = hasAttachments || alternatives.length > 1;

  // Standard headers
  lines.push(foldHeader('From', encodeAddress(message.sender)));
  lines.push(foldHeader('To', message.recipients.map(encodeAddress).join(', ')));

  if (message.ccRecipients.length > 0) {
    lines.push(foldHeader('Cc', message.ccRecipients.map(encodeAddress).join(', ')));
  }

  if (message.replyRecipients.length > 0) {
    lines.push(foldHeader('Reply-To', message.replyRecipients.map(encodeAddress).join(', ')));
  }

  lines.push(foldHeader('Subject', encodeHeaderValue(message.subject, true)));

  // The identity and threading fields all carry structured values, so they are
  // written verbatim rather than RFC 2047 encoded.
  lines.push(foldHeader('Date', resolveDate(message)));
  lines.push(foldHeader('Message-ID', resolveMessageId(message)));
  const threading = resolveThreadingHeaders(message);
  for (const name of ['In-Reply-To', 'References']) {
    // A field the message does not own falls back to a custom header, one it
    // owns but left empty writes nothing at all.
    const owned = threading.get(name);
    const value = owned === undefined ? overridden(message, name) : owned;
    if (value != null) lines.push(foldHeader(name, value));
  }

  // Names already written above, plus Cc and Reply-To even when the message
  // carries no such recipients: a custom header there would list addresses the
  // envelope never receives.  The identity and threading names are here
  // unconditionally too, even when nothing was written: each of them has had
  // its one chance to be emitted above, from the typed field or from the very
  // custom header this loop would otherwise write again.
  const composed = new Set([
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

  // Priority header
  if (message.priority !== 'normal') {
    const priorityValue = message.priority === 'high' ? '1' : '5';
    lines.push(`X-Priority: ${priorityValue}`);
    lines.push(`X-MSMail-Priority: ${message.priority === 'high' ? 'High' : 'Low'}`);
    composed.add('x-priority');
    composed.add('x-msmail-priority');
  }

  // Custom headers
  for (const [key, value] of message.headers) {
    const name = key.toLowerCase();
    if (composed.has(name) || reservedHeaders.has(name)) continue;
    lines.push(foldHeader(key, encodeHeaderValue(value)));
  }

  // MIME headers
  lines.push('MIME-Version: 1.0');

  if (isMultipart) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
    lines.push('This is a multi-part message in MIME format.');
    lines.push('');

    // Content part
    lines.push(`--${boundary}`);

    if (alternatives.length > 1) {
      const contentBoundary = generateBoundary();
      lines.push(`Content-Type: multipart/alternative; boundary="${contentBoundary}"`);
      lines.push('');

      for (const alternative of alternatives) {
        lines.push(`--${contentBoundary}`);
        lines.push(`Content-Type: ${alternative.contentType}`);
        lines.push(`Content-Transfer-Encoding: ${alternative.encoding}`);
        lines.push('');
        lines.push(alternative.body);
        lines.push('');
      }

      lines.push(`--${contentBoundary}--`);
    } else {
      lines.push(`Content-Type: ${alternatives[0].contentType}`);
      lines.push(`Content-Transfer-Encoding: ${alternatives[0].encoding}`);
      lines.push('');
      lines.push(alternatives[0].body);
    }

    // Attachments.  A message is structural input, not only one built by
    // createMessage(), so the fields written into part headers as given are
    // checked again here, as the addresses and the custom headers are.
    for (const attachment of message.attachments) {
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

      if (attachment.inline) {
        lines.push(
          foldHeader(
            'Content-Disposition',
            `inline; ${encodeMimeParameter('filename', attachment.filename)}`,
          ),
        );
        lines.push(foldHeader('Content-ID', `<${attachment.contentId}>`));
      } else {
        lines.push(
          foldHeader(
            'Content-Disposition',
            `attachment; ${encodeMimeParameter('filename', attachment.filename)}`,
          ),
        );
      }

      lines.push('');
      lines.push({ content: attachment.content });
    }

    lines.push('');
    lines.push(`--${boundary}--`);
  } else {
    // Single part message
    lines.push(`Content-Type: ${alternatives[0].contentType}`);
    lines.push(`Content-Transfer-Encoding: ${alternatives[0].encoding}`);
    lines.push('');
    lines.push(alternatives[0].body);
  }

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
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) return true;
  }
  return false;
};

const generateBoundary = () => {
  return `boundary-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
const resolveMessageId = (message) => {
  if (message.messageId !== undefined) {
    return formatMessageId(message.messageId);
  }
  const custom = overridden(message, 'Message-ID');
  if (custom != null) return custom;
  return formatMessageId(generateSenderMessageId(message.sender.address));
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
  const pad = (value) => value.toString().padStart(2, '0');
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
  if (address.name == null) {
    // No display name, just return the email address
    return address.address;
  }

  // Encode only the display name part, leave email address as-is.  An
  // encoded word holds no specials, but plain text that is more than atoms is
  // quoted, or "<", "," and "@" in it would make another mailbox.
  const encodedDisplayName = encodeHeaderValue(address.name, true);
  const displayName =
    encodedDisplayName === address.name ? formatPhrase(address.name) : encodedDisplayName;
  return `${displayName} <${address.address}>`;
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
    const characterBytes =
      codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
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

const encodeMimeParameter = (name, value) => {
  const escapedValue = value.replace(/[\\"]/g, '\\$&');
  const quotedParameter = `${name}="${escapedValue}"`;
  if (/^[\x20-\x7E]*$/.test(value) && quotedParameter.length <= 60) {
    return quotedParameter;
  }

  const encodedBytes = Array.from(new TextEncoder().encode(value), (byte) => {
    const character = String.fromCharCode(byte);
    return /^[A-Za-z0-9!#$&+.^_`|~-]$/.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  });
  const segments = [];
  let segment = '';

  for (const encodedByte of encodedBytes) {
    if (segment.length + encodedByte.length > 45) {
      segments.push(segment);
      segment = '';
    }
    segment += encodedByte;
  }
  if (segment.length > 0 || segments.length === 0) segments.push(segment);

  return segments
    .map((part, index) => `${name}*${index}*=${index === 0 ? "UTF-8''" : ''}${part}`)
    .join('; ');
};

const foldHeader = (name, value) => {
  if (!/^[\x21-\x39\x3b-\x7e]+$/.test(name)) {
    throw new TypeError(
      'Header field name must contain printable ASCII characters other than colon.',
    );
  }
  const recommendedLineLength = 78;
  const lines = [];
  let prefix = `${name}: `;
  let remaining = value;

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
  if (lines.some((line) => Buffer.byteLength(line) > 998)) {
    throw new RangeError(`Header field ${name} contains a token too long to fold.`);
  }
  return lines.join('\r\n');
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
