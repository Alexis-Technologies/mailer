// Not ported: the front matter of a template, its `subject` and `layout`
// between two `---` lines at its start, read in one pass of `indexOf`, with
// no pattern to backtrack over a long template.

// The keys a front matter may hold: a typo is an error, not a key ignored.
const KEYS = new Set(['subject', 'layout']);

const unquote = (value) => {
  const quote = value[0];
  if (value.length >= 2 && (quote === '"' || quote === "'") && value.at(-1) === quote) {
    return value.slice(1, -1);
  }
  return value;
};

// A line without its CR, for a template written with CRLF.
const lineOf = (source, start, end) =>
  source.charCodeAt(end - 1) === 13 ? source.slice(start, end - 1) : source.slice(start, end);

/**
 * Reads the front matter of a template: `---`, lines of `key: value`, `---`,
 * at its very start (after a BOM).  A value may be quoted; a line that is
 * empty or starts with `#` is skipped.
 *
 * @param source The source of the template.
 * @returns `{ body, fields }`: the source after the front matter, and its
 * fields, `undefined` when it has none.
 * @throws {SyntaxError} If the front matter is not closed, a line is not
 * `key: value`, or a key is unknown or repeated.
 * @internal
 */
const parseFrontMatter = (source) => {
  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (!source.startsWith('---', start)) return { body: source, fields: undefined };
  const firstEnd = source.indexOf('\n', start);
  if (firstEnd === -1 || lineOf(source, start, firstEnd) !== '---') {
    return { body: source, fields: undefined };
  }
  const fields = Object.create(null);
  let at = firstEnd + 1;
  for (;;) {
    if (at > source.length) throw new SyntaxError('The front matter has no closing ---.');
    const newline = source.indexOf('\n', at);
    const end = newline === -1 ? source.length : newline;
    const line = lineOf(source, at, end).trim();
    if (line === '---') return { body: source.slice(end + 1), fields };
    if (line !== '' && line[0] !== '#') {
      const colon = line.indexOf(':');
      if (colon <= 0) {
        throw new SyntaxError(`A line of the front matter is not "key: value": ${line}`);
      }
      const key = line.slice(0, colon).trim();
      if (!KEYS.has(key)) {
        throw new SyntaxError(
          `The front matter has no key ${JSON.stringify(key)}: subject or layout.`,
        );
      }
      if (key in fields) throw new SyntaxError(`The front matter gives ${key} twice.`);
      fields[key] = unquote(line.slice(colon + 1).trim());
    }
    at = end + 1;
  }
};

module.exports = { parseFrontMatter };
