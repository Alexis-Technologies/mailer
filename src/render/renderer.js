// Ported from unemail v0.7.0 (src/render/index.ts): a renderer turns the input
// of a template into the content of a message, its text derived from its HTML
// when it gives none, `withRender`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the content is rendered before `createMessage`, which
// takes it, rather than by a middleware of the send; and what the renderer
// gives is checked.

const { htmlToText } = require('./html-to-text.js');

/**
 * Renders the content of a message: `{ html, text }` for `createMessage`, the
 * text derived from the HTML with `htmlToText` when the renderer gives none.
 *
 * @param renderer An object with `render(input)`, sync or async, which gives
 * `{ html?, text? }`.
 * @param input What the renderer takes, such as a React element.
 * @param options `autoText` (true): derive the text when there is none.
 * @returns The content.
 * @throws {TypeError} If the renderer is not one, or gives no string.
 */
const renderContent = async (renderer, input, options = {}) => {
  const autoText = checkRender(renderer, options);
  return toContent(await renderer.render(input), autoText);
};

/**
 * Renders the subject and the content of a message: what `renderContent`
 * gives, and the subject the renderer gave with it, if any.
 *
 * @param renderer An object with `render(input)`, sync or async, which gives
 * `{ html?, text?, subject? }`.
 * @param input What the renderer takes.
 * @param options `autoText` (true): derive the text when there is none.
 * @returns `{ subject, content }`, `subject` undefined when the renderer gave
 * none.
 * @throws {TypeError} As `renderContent` does, or if the subject is not a
 * string.
 */
const renderFields = async (renderer, input, options = {}) => {
  const autoText = checkRender(renderer, options);
  const output = await renderer.render(input);
  const subject = output?.subject;
  if (subject !== undefined && typeof subject !== 'string') {
    throw new TypeError('A renderer gives the subject as a string.');
  }
  const content = toContent(output, autoText);
  return subject === undefined ? { content } : { subject, content };
};

// Checks the renderer and the options of a render, and gives `autoText`.
const checkRender = (renderer, options) => {
  if (typeof renderer?.render !== 'function') {
    throw new TypeError('renderer must have a render method.');
  }
  const autoText = options.autoText ?? true;
  if (typeof autoText !== 'boolean') throw new TypeError('autoText must be a boolean.');
  return autoText;
};

/**
 * The content of a message from what a renderer gave: its HTML and its text,
 * the text derived from the HTML when it gave none and `autoText` is on.
 *
 * @param output What the renderer gave.
 * @param autoText Whether to derive the text.
 * @returns The content.
 * @throws {TypeError} If the output holds no string.
 * @internal
 */
const toContent = (output, autoText) => {
  const html = output?.html;
  const text = output?.text;
  if (
    (html !== undefined && typeof html !== 'string') ||
    (text !== undefined && typeof text !== 'string')
  ) {
    throw new TypeError('A renderer gives html and text as strings.');
  }
  if (html === undefined) {
    if (text === undefined) throw new TypeError('The renderer gave neither html nor text.');
    return { text };
  }
  const plain = text ?? (autoText ? htmlToText(html) : undefined);
  return plain === undefined ? { html } : { html, text: plain };
};

module.exports = { renderContent, renderFields, toContent };
