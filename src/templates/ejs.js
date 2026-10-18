// Not ported: the EJS engine of ./templates, over the `ejs` the application
// passes in.  Its includes are read through the loader, by `includer`, so EJS
// reads no file itself; the context is only the data of the template, never
// its options.  @nestjs-modules/mailer let an async template's promise reject
// unheard, which hung the send.

const {
  checkEngineExtensions,
  checkEngineOptions,
  checkEscaping,
  checkModule,
} = require('./options.js');

const RESERVED = new Set(['filename', 'root', 'views', 'includer', 'cache', 'client']);
// The options of ejs.compile that replace its escaping.
const UNESCAPED = new Map([
  ['escape', () => true],
  ['escapeFunction', () => true],
]);

/**
 * Makes the EJS engine.
 *
 * @param options `ejs`, the module of `ejs`; `options` of `ejs.compile`, such as
 * `async`, `strict` or the delimiters; `extensions` (`['.ejs']`).
 * @returns The engine.
 * @throws {TypeError} If `ejs` is not EJS or an option is reserved.
 */
const createEjsEngine = (options = {}) => {
  const ejs = checkModule(
    options.ejs,
    'compile',
    'createEjsEngine needs ejs: the module of the ejs package.',
  );
  const given = checkEngineOptions(options.options, RESERVED, 'ejs');
  checkEscaping(options, given, UNESCAPED, 'ejs');
  const extensions = checkEngineExtensions(options.extensions, ['.ejs']);
  return {
    name: 'ejs',
    extensions,
    compile(source, context) {
      // EJS tells the includer the name written, not the template it is
      // written in: a relative include is read against the template rendered.
      const includer = (include) => {
        const found = context.includes.lookupSync(include, context.name, extensions);
        return { filename: found.path ?? found.name, template: found.source };
      };
      return ejs.compile(source, {
        ...given,
        filename: context.path ?? context.name,
        includer,
        cache: false,
        client: false,
      });
    },
  };
};

module.exports = { createEjsEngine };
