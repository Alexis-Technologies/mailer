// Not ported: the MJML engine of ./templates, over the `mjml2html` the
// application passes in: a static `.mjml`, or a template of another engine
// that MJML renders after it, its layout applied.  @nestjs-modules/mailer
// dropped the error of the engine inside and rendered `undefined`, ignored
// what MJML found wrong, and could not render a static MJML at all.

const { checkOptionalFunction } = require('../internal/options.js');
const { warnLimited } = require('../internal/warn.js');
const { checkEngineExtensions, checkEngineOptions, checkModule } = require('./options.js');

const RESERVED = new Set([
  'filePath',
  'ignoreIncludes',
  'includePath',
  'mjmlConfigPath',
  'useMjmlConfigOptions',
  'skeleton',
]);

const describeErrors = (errors) => {
  let text = '';
  for (const error of errors) {
    const line = error?.line === undefined ? '' : `line ${error.line}: `;
    text += `${text === '' ? '' : '; '}${line}${error?.message ?? String(error)}`;
  }
  return text;
};

/**
 * Makes the MJML engine.
 *
 * @param options `mjml2html`, the module of `mjml`; `engine`, the engine of the
 * template MJML renders after; `options` of MJML, such as `validationLevel`
 * ('soft'); `includes` (false), to let `mj-include` read the files next to a
 * template on disk, which MJML reads itself; `onErrors(errors, template)`, for
 * what MJML finds under 'soft', a warning by default; `extensions`.
 * @returns The engine.
 * @throws {TypeError} If `mjml2html` is not a function or an option is
 * invalid.
 */
const createMjmlEngine = (options = {}) => {
  const mjml2html = checkModule(
    options.mjml2html,
    undefined,
    'createMjmlEngine needs mjml2html: the module of the mjml package.',
  );
  const inner = options.engine;
  if (inner !== undefined && typeof inner?.compile !== 'function') {
    throw new TypeError('The engine of the MJML engine must be a template engine.');
  }
  const given = checkEngineOptions(options.options, RESERVED, 'mjml');
  const includes = options.includes ?? false;
  if (typeof includes !== 'boolean') throw new TypeError('includes must be a boolean.');
  const onErrors = checkOptionalFunction(options.onErrors, 'onErrors');
  const defaults = [];
  if (inner === undefined) defaults.push('.mjml');
  else for (const extension of inner.extensions) defaults.push(`.mjml${extension}`);
  const extensions = checkEngineExtensions(options.extensions, defaults);

  const toHtml = async (mjml, context) => {
    const result = await mjml2html(mjml, {
      validationLevel: 'soft',
      ...given,
      ignoreIncludes: !includes,
      ...(includes && context.path !== undefined ? { filePath: context.path } : {}),
    });
    const errors = result?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      if (onErrors === undefined) {
        warnLimited(
          'MAILER_TEMPLATE_MJML',
          `MJML found errors in ${context.name}: ${describeErrors(errors)}`,
        );
      } else {
        onErrors(errors, context.name);
      }
    }
    if (typeof result?.html !== 'string') throw new TypeError('mjml2html gave no html.');
    return result.html;
  };

  return {
    name: inner === undefined ? 'mjml' : `mjml+${inner.name}`,
    extensions,
    async compile(source, context) {
      if (inner !== undefined) return inner.compile(source, context);
      // A static template is rendered by MJML once; its text and subject are
      // text as they are.
      if (context.part !== 'html') return () => source;
      const html = await toHtml(source, context);
      return () => html;
    },
    ...(inner === undefined ? {} : { finish: toHtml }),
  };
};

module.exports = { createMjmlEngine };
