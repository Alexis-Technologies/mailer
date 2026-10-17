// Ported from unemail v0.7.0 (src/render/_html.ts): the plain text of an HTML
// body, `htmlToText`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: one pass over the HTML, linear in its length, where
// unemail's lazy patterns rescanned the rest of the input for each unclosed
// `<a` or `<script`; comments, conditional comments and the doctype are
// dropped, where unemail left them in the text (React Email writes `<!--$-->`
// into every body), and so are `head`, `title` and what is marked
// `data-skip-in-text`, such as the preview text of React Email; an `href` in
// single quotes or none is read; the whitespace of the source collapses, as a
// browser shows it, but in `pre`; and a list item gets its bullet or number.

const { decodeEntities } = require('./entities.js');

// Their content is not text.
const SKIPPED = new Set(['script', 'style', 'head', 'title', 'template']);
// A paragraph: a blank line before and after.
const PARAGRAPHS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'table',
  'ul',
  'ol',
  'dl',
  'hr',
  'figure',
]);
// A line of its own.
const LINES = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'address',
  'center',
  'tr',
  'td',
  'th',
  'thead',
  'tbody',
  'tfoot',
  'dt',
  'dd',
  'figcaption',
  'body',
]);
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const WHITESPACE = /[ \t\n\r\f]+/g;
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const isNameCharacter = (code) =>
  (code >= 97 && code <= 122) ||
  (code >= 65 && code <= 90) ||
  (code >= 48 && code <= 57) ||
  code === 45;

// The attributes of a tag, by lowercased name.
const attributesOf = (text) => {
  const attributes = new Map();
  for (const match of text.matchAll(ATTRIBUTE)) {
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attributes.set(match[1].toLowerCase(), decodeEntities(value));
  }
  return attributes;
};

// The end of a tag: the `>` outside the quotes of its attributes.
const tagEndOf = (html, from) => {
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (c === '>') return i;
    if (c === '"' || c === "'") {
      const close = html.indexOf(c, i + 1);
      if (close < 0) return -1;
      i = close;
    }
  }
  return -1;
};

const isUsableHref = (href) => {
  const lower = href.trim().toLowerCase();
  return lower !== '' && !lower.startsWith('#') && !lower.startsWith('javascript:');
};

/**
 * The plain text an HTML body reads as, for the text alternative of a
 * message.
 *
 * @internal
 */
class TextWriter {
  out = '';
  #breaks = 0;
  #prefix = '';
  #pre = 0;
  #lists = [];
  #links = [];

  // A break before the next text: 1 for a line, 2 for a paragraph.
  breakLine(count) {
    if (this.#breaks < count) this.#breaks = count;
  }

  lineBreak() {
    this.#breaks = Math.min(this.#breaks + 1, 2);
    if (this.out === '') this.#breaks = 0;
  }

  text(raw) {
    let text = this.#pre > 0 ? raw.replaceAll('\r\n', '\n') : raw.replace(WHITESPACE, ' ');
    text = decodeEntities(text);
    if (this.#pre === 0 && (this.out === '' || this.#breaks > 0 || this.out.endsWith('\n'))) {
      text = text.trimStart();
    }
    if (text === '') return;
    if (this.#breaks > 0 && this.out !== '') {
      this.#trimEnd();
      this.out += this.#breaks === 2 ? '\n\n' : '\n';
    }
    this.#breaks = 0;
    this.out += this.#prefix + text;
    this.#prefix = '';
  }

  open(name, attributes) {
    if (name === 'pre') this.#pre++;
    if (name === 'ul' || name === 'ol') this.#lists.push({ ordered: name === 'ol', count: 0 });
    if (name === 'li') {
      this.breakLine(1);
      const list = this.#lists.at(-1);
      if (list?.ordered) this.#prefix = `${++list.count}. `;
      else this.#prefix = '- ';
    }
    if (name === 'a') {
      const href = attributes?.get('href');
      this.#links.push({ href, start: this.out.length });
    }
  }

  close(name) {
    if (name === 'pre' && this.#pre > 0) this.#pre--;
    if ((name === 'ul' || name === 'ol') && this.#lists.length > 0) this.#lists.pop();
    if (name === 'a') this.#closeLink();
  }

  // Keeps where a link goes: its address after its label, or in place of an
  // empty one, once.
  #closeLink() {
    const link = this.#links.pop();
    if (link === undefined || link.href === undefined || !isUsableHref(link.href)) return;
    const href = link.href.trim();
    const address = href.toLowerCase().startsWith('mailto:') ? href.slice(7) : href;
    // A label much longer than the address differs from it; one this long
    // is not read, so that nested links stay linear.
    if (this.out.length - link.start > href.length + 8) {
      this.out += ` (${href})`;
      return;
    }
    const label = this.out.slice(link.start).trim();
    if (label === '') this.text(address);
    else if (label !== href && label !== address) this.out += ` (${href})`;
  }

  #trimEnd() {
    let end = this.out.length;
    while (end > 0 && (this.out[end - 1] === ' ' || this.out[end - 1] === '\t')) end--;
    if (end < this.out.length) this.out = this.out.slice(0, end);
  }

  finish() {
    this.#trimEnd();
    return this.out;
  }
}

/**
 * The plain text an HTML body reads as: the text of its elements, a line or a
 * blank line for its blocks, list items with a bullet or a number, and the
 * address of each link after its label.  Scripts, styles, the head, comments
 * and what is marked `data-skip-in-text` are left out.  It handles what a
 * mail body holds, in one pass; set `text` yourself when fidelity matters.
 *
 * @param html The HTML.
 * @returns The text.
 */
const htmlToText = (html) => {
  if (typeof html !== 'string') throw new TypeError('htmlToText takes a string.');
  const lower = html.toLowerCase();
  const writer = new TextWriter();
  // The element skipped as `data-skip-in-text`, and its depth.
  let skip;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    const textEnd = lt < 0 ? html.length : lt;
    if (textEnd > i && skip === undefined) writer.text(html.slice(i, textEnd));
    if (lt < 0) break;
    i = readTag(html, lower, lt, writer, (tag) => {
      if (skip !== undefined) {
        if (tag.name === skip.name && tag.closing) skip.depth--;
        else if (tag.name === skip.name && !tag.selfClosing) skip.depth++;
        if (skip.depth === 0) skip = undefined;
        return;
      }
      if (!tag.closing && !tag.selfClosing && tag.skipInText) {
        skip = { name: tag.name, depth: 1 };
        return;
      }
      applyTag(writer, tag);
    });
  }
  return writer.finish();
};

const applyTag = (writer, tag) => {
  if (tag.name === 'br') {
    writer.lineBreak();
    return;
  }
  if (PARAGRAPHS.has(tag.name)) writer.breakLine(2);
  else if (LINES.has(tag.name)) writer.breakLine(1);
  if (tag.closing) writer.close(tag.name);
  else writer.open(tag.name, tag.attributes);
};

// Reads the markup at `<`, hands an element tag to `onTag`, and returns where
// the text goes on.
const readTag = (html, lower, at, writer, onTag) => {
  if (html.startsWith('<!--', at)) {
    const end = html.indexOf('-->', at + 4);
    return end < 0 ? html.length : end + 3;
  }
  const next = html[at + 1];
  if (next === '!' || next === '?') {
    const end = html.indexOf('>', at);
    return end < 0 ? html.length : end + 1;
  }
  const closing = next === '/';
  const nameStart = at + (closing ? 2 : 1);
  let nameEnd = nameStart;
  while (nameEnd < html.length && isNameCharacter(html.charCodeAt(nameEnd))) nameEnd++;
  if (nameEnd === nameStart) {
    // A `<` that opens no tag is text.
    writer.text('<');
    return at + 1;
  }
  const end = tagEndOf(html, nameEnd);
  if (end < 0) return html.length;
  const name = lower.slice(nameStart, nameEnd);
  if (!closing && SKIPPED.has(name)) {
    const close = lower.indexOf(`</${name}`, end + 1);
    if (close < 0) return html.length;
    const closeEnd = html.indexOf('>', close);
    return closeEnd < 0 ? html.length : closeEnd + 1;
  }
  const inner = html.slice(nameEnd, end);
  const selfClosing = VOID.has(name) || inner.endsWith('/');
  const needsAttributes = name === 'a' || inner.includes('data-skip-in-text');
  const attributes = !closing && needsAttributes ? attributesOf(inner) : undefined;
  onTag({
    name,
    closing,
    selfClosing,
    attributes,
    skipInText: attributes?.get('data-skip-in-text') === 'true',
  });
  return end + 1;
};

module.exports = { htmlToText };
