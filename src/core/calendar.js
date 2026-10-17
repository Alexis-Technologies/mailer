// Ported from upyo v0.7.0 (packages/core/src/calendar.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * The shape of an RFC 5545 §3.1 component name: an `iana-token` or an `x-name`,
 * both of which are one or more of ALPHA, DIGIT and `-`.  Matched against the
 * already upper-cased value.
 */
const componentNamePattern = /^[A-Z0-9-]+$/;

const calendarMethods = new Set([
  'PUBLISH',
  'REQUEST',
  'REPLY',
  'ADD',
  'CANCEL',
  'REFRESH',
  'COUNTER',
  'DECLINECOUNTER',
]);

/**
 * Reads the method a calendar object declares.
 *
 * This is a convenience parser for a payload arriving from elsewhere, so it
 * returns `undefined` rather than throwing, the way {@link parseMessageId}
 * does.  It answers one question—which iTIP method does this object declare?—
 * and answers `undefined` whenever it cannot answer with confidence: no
 * `METHOD` at the top level, more than one, a method Upyo does not support, or
 * malformed content line syntax or component structure.  It never salvages a
 * plausible token from malformed input.
 *
 * Use {@link resolveCalendarContent} instead when you want to know *why* a
 * payload was refused.
 *
 * @example
 * ```ts
 * import { parseCalendarMethod } from "@alexify/mailer";
 * parseCalendarMethod("BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n");
 * // "REQUEST"
 * ```
 *
 * @param content The iCalendar object to read.
 * @returns The declared method, or `undefined` if there is not exactly one
 *          supported top-level method.
 */
const parseCalendarMethod = (content) => {
  if (typeof content !== 'string') return undefined;
  try {
    return readMethod(normalizeLineEndings(content));
  } catch {
    return undefined;
  }
};

/**
 * Checks a scheduling payload and puts it in the form a transport serializes.
 *
 * A transport calls this before composing, the way it calls
 * {@link formatMessageId}: {@link Message} is a structural interface, so a
 * value that never passed through {@link createMessage} still has to be checked
 * before its method reaches a `Content-Type` parameter.
 *
 * This is deliberately not a full iCalendar validator.  It checks what MIME
 * composition depends on: the syntax of every content line, one calendar
 * object with balanced components, and exactly one supported method.  It
 * leaves property-specific value syntax and scheduling semantics to the caller.
 * Whether the object names an `ORGANIZER`, carries a stable `UID`, bumps
 * `SEQUENCE` on an update, or satisfies the iTIP constraints for its method is
 * not checked here.
 *
 * @example
 * ```ts
 * import { resolveCalendarContent } from "@alexify/mailer";
 * const calendar = resolveCalendarContent({ content: ics });
 * calendar.method;  // "REQUEST"
 * ```
 *
 * @param calendar The payload to check.
 * @returns The payload with CRLF line endings and a resolved method.
 * @throws {TypeError} If the content is not a single well-formed calendar
 * object with valid content line syntax, if it does not declare exactly one
 * supported method, or if it declares a method other than the one asserted.
 */
const resolveCalendarContent = (calendar) => {
  const content = normalizeLineEndings(calendar.content ?? '');
  const method = readMethod(content);
  if (method == null) {
    throw new TypeError(
      'The calendar content declares no supported top-level METHOD property.  ' +
        'Add one, such as `METHOD:REQUEST`, to the VCALENDAR object: RFC 6047 ' +
        '§2.4 requires the MIME method parameter to repeat it, and a calendar ' +
        'client reads the property rather than the parameter.',
    );
  }
  if (calendar.method != null && calendar.method !== method) {
    throw new TypeError(
      `The calendar content declares METHOD:${method}, but ${JSON.stringify(
        calendar.method,
      )} was given.  Leave the method unset to take it from the content.`,
    );
  }
  return { method, content };
};

/**
 * Builds the *invite.ics* part that stands in for a calendar alternative.
 *
 * A transport that cannot compose a `text/calendar` body alternative falls back
 * to this, so the payload travels rather than being dropped.  The part keeps
 * the calendar media type and the `method` parameter, which is what a client
 * needs to treat it as scheduling content, but whether a provider preserves
 * that parameter is the provider's business; see the transport's documentation.
 *
 * The content ID is empty, which marks the part as an ordinary attachment
 * across the transports that infer inline disposition from one.
 *
 * @param calendar The payload to carry.
 * @returns An attachment holding the calendar object.
 * @throws {TypeError} If the payload is not valid; see
 * {@link resolveCalendarContent}.
 */
const createCalendarAttachment = (calendar) => {
  const resolved = resolveCalendarContent(calendar);
  return {
    inline: false,
    filename: 'invite.ics',
    content: new TextEncoder().encode(resolved.content),
    // The charset is declared because RFC 6047 §2.4 requires it once the object
    // leaves US-ASCII, and MIME would otherwise default to it and mis-read the
    // UTF-8 bytes encoded above.
    contentType: `text/calendar; charset=utf-8; method=${resolved.method}`,
    contentId: '',
  };
};

/**
 * Normalizes line endings to CRLF and ensures a terminating one.
 *
 * RFC 5545 §3.1 makes CRLF the line ending of a content line, but a caller
 * routinely holds an object with bare LFs, whether from a template file or from
 * a generator that never wrote it to the wire.  Bare CR is normalized too, so
 * that an old-Mac-style payload does not read as one enormous line.
 *
 * Blank lines around the object are dropped: a template literal opening with a
 * newline, or a file saved with a trailing blank line, is ordinary, and no
 * folded continuation can reach across an edge.  A blank line *inside* the
 * object is left for {@link unfold} to refuse.
 *
 * @param content The object to normalize.
 * @returns The object with CRLF line endings, or the empty string unchanged.
 */
const normalizeLineEndings = (content) => {
  const normalized = content
    .replace(/\r\n|\r|\n/g, '\r\n')
    .replace(/^(?:\r\n)+/, '')
    .replace(/(?:\r\n)+$/, '');
  return normalized === '' ? '' : `${normalized}\r\n`;
};

/**
 * Reads the one top-level method of a well-formed calendar object.
 *
 * Top level means the component stack is exactly `VCALENDAR`: a `METHOD` inside
 * `VEVENT` or `VTIMEZONE` is a different property that happens to share a name,
 * and a `METHOD:` appearing inside a property value is text.  Scanning
 * continues past components rather than stopping at the first, so a second
 * top-level `METHOD` written after one is still noticed.
 *
 * @param content The object, already normalized to CRLF.
 * @returns The declared method, or `undefined` if there is not exactly one that
 *          Upyo supports.
 * @throws {TypeError} If the content is not a single well-formed calendar
 * object.
 */
const readMethod = (content) => {
  // Check the transmitted text before unfolding: a fold between two lone
  // surrogates must not rescue them into a pair only in the parsed view.
  checkSurrogates(content);
  const stack = [];
  let closed = false;
  let method;
  let methods = 0;

  for (const line of unfold(content)) {
    const parsed = parseContentLine(line);
    const { name } = parsed;
    const value =
      name === 'BEGIN' || name === 'END' || (name === 'METHOD' && stack.length === 1)
        ? asciiUpperCase(parsed.value)
        : parsed.value;

    // Every line has passed the generic grammar.  Component delimiters also
    // have the stricter BEGIN:<name> / END:<name> shape from RFC 5545 §3.4.
    if ((name === 'BEGIN' || name === 'END') && parsed.hasParameters) {
      throw new TypeError(`The calendar content carries parameters on a ${name} delimiter.`);
    }

    if (name === 'BEGIN') {
      checkComponentStart(stack, value, closed);
      stack.push(value);
      continue;
    }
    if (name === 'END') {
      if (stack.pop() !== value) {
        throw new TypeError(
          `The calendar content closes ${JSON.stringify(value)} that was never opened.`,
        );
      }
      if (stack.length < 1) closed = true;
      continue;
    }
    if (stack.length < 1) {
      throw new TypeError('The calendar content holds a property outside any VCALENDAR object.');
    }
    if (name === 'METHOD' && stack.length === 1) {
      methods++;
      method = calendarMethods.has(value) ? value : undefined;
    }
  }

  if (stack.length > 0) {
    throw new TypeError(
      `The calendar content leaves ${JSON.stringify(stack[stack.length - 1])} unclosed.`,
    );
  }
  if (!closed) {
    throw new TypeError('The calendar content holds no VCALENDAR object.');
  }
  return methods === 1 ? method : undefined;
};

const checkSurrogates = (content) => {
  for (const character of content) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) {
      throw new TypeError('The calendar content contains an unpaired UTF-16 surrogate.');
    }
  }
};

/**
 * Checks a BEGIN line against the components open so far.
 *
 * @param stack The names of the open components, outermost first.
 * @param value The name of the component the line opens.
 * @param closed Whether a VCALENDAR object has already been closed.
 * @throws {TypeError} If the component cannot open here.
 */
const checkComponentStart = (stack, value, closed) => {
  if (closed) {
    throw new TypeError(
      'The calendar content holds more than one VCALENDAR object, but a message carries one.',
    );
  }
  if (stack.length < 1 && value !== 'VCALENDAR') {
    throw new TypeError(
      `The calendar content begins with ${JSON.stringify(value)} rather than a VCALENDAR object.`,
    );
  }
  // RFC 5545 §3.4 has no VCALENDAR inside a VCALENDAR.  A nested one
  // balances, so nothing else in this scan would notice it, and the object
  // would be sent as though it were the single one this API accepts.
  if (stack.length > 0 && value === 'VCALENDAR') {
    throw new TypeError('The calendar content nests a VCALENDAR object inside another.');
  }
  // A component name is an `iana-token` or an `x-name`, both of which are
  // one or more of ALPHA, DIGIT and "-".  A malformed name balances with
  // its END the same way a well-formed one does, so it has to be checked
  // here or not at all.
  if (!componentNamePattern.test(value)) {
    throw new TypeError(
      `The calendar content opens a component named ${JSON.stringify(
        value,
      )}, which is not a component name.`,
    );
  }
};

/**
 * Upper-cases the ASCII letters of a token, leaving everything else alone.
 *
 * RFC 5545 tokens are ASCII, and the case-insensitivity this folding implements
 * is only ever applied to them.  `String.prototype.toUpperCase` would apply the
 * full Unicode mapping instead, under which `\u017F` becomes `S` and `\u0131`
 * becomes `I`, so `METHOD:reque\u017Ft` would read as `REQUEST`.  The payload
 * would still carry the character no calendar client accepts, and the
 * `Content-Type` would name a method the object does not declare, which is the
 * exact disagreement this module exists to prevent.
 *
 * @param token The token to fold.
 * @returns The token with its ASCII letters upper-cased.
 */
const asciiUpperCase = (token) => {
  return token.replace(/[a-z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) - 32));
};

/**
 * Parses the generic content line grammar of RFC 5545 §3.1.
 *
 * VALUE-CHAR allows HTAB, printable ASCII and non-ASCII characters.  QSAFE-CHAR
 * further excludes quotes, and SAFE-CHAR also excludes commas, semicolons and
 * colons.  After checking VALUE-CHAR across the line, the cursor recognizes
 * those delimiters only where the parameter grammar permits them.  Backslashes
 * and caret sequences are data; property-specific value syntax is not checked.
 *
 * @param line An unfolded line from already well-formed UTF-16 content.
 * @returns The ASCII-folded name, unchanged value and parameter presence.
 * @throws {TypeError} If the line does not match the content line grammar.
 */
const parseContentLine = (line) => {
  const fail = (reason) => {
    throw new TypeError(`The calendar content has ${reason}: ${JSON.stringify(line)}`);
  };

  for (const character of line) {
    const code = character.codePointAt(0);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
      fail('a forbidden control character in a content line');
    }
  }

  let cursor = 0;
  const readName = () => {
    const start = cursor;
    while (isTokenCharacter(line.charCodeAt(cursor))) cursor++;
    if (cursor === start) fail('an invalid property or parameter name');
    return line.slice(start, cursor);
  };

  const name = asciiUpperCase(readName());
  const hasParameters = line[cursor] === ';';
  while (line[cursor] === ';') {
    cursor++;
    readName();
    if (line[cursor] !== '=') fail('a parameter without an equals sign');
    cursor++;

    // Both paramtext and quoted-string may be empty.  A comma therefore
    // always starts another value, even immediately before ';' or ':'.
    cursor = skipParameterValue(line, cursor, fail);
    while (line[cursor] === ',') cursor = skipParameterValue(line, cursor + 1, fail);
    if (line[cursor] !== ';' && line[cursor] !== ':') {
      fail('an invalid delimiter after a parameter value');
    }
  }
  if (line[cursor] !== ':') fail('a missing content line value separator');
  return { name, value: line.slice(cursor + 1), hasParameters };
};

/**
 * Skips one parameter value, quoted or not, from a cursor.
 *
 * @param line The content line.
 * @param start Where the value starts.
 * @param fail Throws the error of the line with a reason.
 * @returns The cursor after the value.
 */
const skipParameterValue = (line, start, fail) => {
  let cursor = start;
  if (line[cursor] === '"') {
    cursor++;
    while (cursor < line.length && line[cursor] !== '"') cursor++;
    if (cursor === line.length) fail('an unterminated quoted parameter');
    return cursor + 1;
  }
  while (
    cursor < line.length &&
    line[cursor] !== ',' &&
    line[cursor] !== ';' &&
    line[cursor] !== ':'
  ) {
    if (line[cursor] === '"') fail('a quote inside an unquoted parameter');
    cursor++;
  }
  return cursor;
};

/** Whether a code unit belongs to the iana-token / x-name character set. */
const isTokenCharacter = (code) => {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2d
  );
};

/**
 * Unfolds the content lines of a calendar object.
 *
 * RFC 5545 §3.1 folds a long line by inserting CRLF and *one* space or tab,
 * which unfolding removes.  Only that one character is removed: the rest of a
 * whitespace run belongs to the value.  A `\n` written inside a property value
 * is an escape sequence rather than a line ending and is left alone, which
 * falls out of splitting on CRLF alone.
 *
 * A continuation joins the line immediately before it, so an empty line is
 * refused rather than skipped over.  Skipping one would let a continuation
 * reach across the gap and assemble a property the transmitted content does not
 * actually hold — a `METHOD` in particular, which would then contradict the
 * MIME parameter naming it.  An iCalendar object has no empty content lines
 * anyway.
 *
 * @param content The object, already normalized to CRLF.
 * @returns The unfolded content lines, without their endings.
 * @throws {TypeError} If the content opens with a continuation line, or holds
 * an empty one.
 */
const unfold = (content) => {
  const split = content.split('\r\n');
  // The terminating CRLF leaves a final empty element that is not a line.
  if (split[split.length - 1] === '') split.pop();

  const lines = [];
  for (const line of split) {
    if (line === '') {
      throw new TypeError('The calendar content holds an empty line.');
    }
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (lines.length < 1) {
        throw new TypeError('The calendar content opens with a folded continuation line.');
      }
      lines[lines.length - 1] += line.slice(1);
      continue;
    }
    lines.push(line);
  }
  return lines;
};

module.exports = { parseCalendarMethod, resolveCalendarContent, createCalendarAttachment };
