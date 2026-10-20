// Not ported: the inlining of the CSS of a message by juice or
// @css-inline/css-inline, passed in.  @nestjs-modules/mailer ran css-inline
// with its defaults, which fetch every remote stylesheet on each send and
// strip the <link> a mail client would have read; and a failure there called
// its callback twice.

const DEFAULTS = Object.freeze({ loadRemoteStylesheets: false, keepLinkTags: true });

/**
 * Makes the CSS inliner of a template renderer.
 *
 * @param options `inline`: the default export of `juice`, or
 * the `inline` of `@css-inline/css-inline`; `options`, passed to it, over
 * `{ loadRemoteStylesheets: false, keepLinkTags: true }`, which css-inline
 * reads and juice, which fetches nothing itself, ignores.
 * @returns `(html) => Promise<string>`.
 * @throws {TypeError} If `inline` is not a function or `options` no object.
 */
const createCssInliner = (options = {}) => {
  const { inline } = options;
  if (typeof inline !== 'function') {
    throw new TypeError(
      'createCssInliner needs inline: juice, or the inline of @css-inline/css-inline.',
    );
  }
  const given = options.options;
  if (given !== undefined && (typeof given !== 'object' || given === null)) {
    throw new TypeError('The options of the CSS inliner must be an object.');
  }
  const settings = { ...DEFAULTS, ...given };
  return async (html) => {
    const inlined = await inline(html, settings);
    if (typeof inlined !== 'string') throw new TypeError('The CSS inliner gave no string.');
    return inlined;
  };
};

module.exports = { createCssInliner };
