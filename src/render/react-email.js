// Ported from unemail v0.7.0 (src/render/react.ts): a renderer of React Email
// components, `reactRenderer`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Also ported from sently v1.2.2 (src/plugins/react.ts): the text of the
// element rendered by React Email's own plain-text pass.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: `render` is passed in, never imported, so the package
// has no dependency on React Email; and a plain-text pass that fails fails the
// render, where unemail let it fall back to the derived text unseen.

/**
 * Makes a renderer of React Email components with the `render` of
 * `@react-email/render` the application passes in.
 *
 * @param options `render`; `plainText` (true), the text from React Email's
 * plain-text pass rather than derived from the HTML; and `renderOptions`,
 * passed to `render`, such as `{ pretty: true }`.
 * @returns The renderer, whose input is a React element.
 * @throws {TypeError} If `render` is not a function.
 */
const createReactEmailRenderer = (options = {}) => {
  const { render, renderOptions } = options;
  if (typeof render !== 'function') {
    throw new TypeError(
      'createReactEmailRenderer needs render, the render function of @react-email/render.',
    );
  }
  const plainText = options.plainText ?? true;
  if (typeof plainText !== 'boolean') throw new TypeError('plainText must be a boolean.');
  return {
    async render(element) {
      if (element === undefined || element === null) {
        throw new TypeError('The React Email renderer needs an element.');
      }
      const html = await render(element, renderOptions);
      if (!plainText) return { html };
      return { html, text: await render(element, { ...renderOptions, plainText: true }) };
    },
  };
};

module.exports = { createReactEmailRenderer };
