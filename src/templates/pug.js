// Not ported: the Pug engine of ./templates, over the `pug` the application
// passes in.  A plugin of `resolve` and `read` takes the place of Pug's disk:
// `include` and `extends` are read through the loader, a name with `/` from
// its root and any other against the file it is written in.  Each template is
// compiled once, and its locals are the context alone, where
// @nestjs-modules/mailer rendered the file again on each send with the
// options of Pug mixed into them.

const { missingTemplate } = require('./environment.js');
const { TemplateNotFoundError } = require('./errors.js');
const { checkEngineExtensions, checkEngineOptions, checkModule } = require('./options.js');

const RESERVED = new Set(['filename', 'basedir', 'cache']);

// Pug's file names are the loader's names with a `/` before them.
const nameOf = (filename) => (filename[0] === '/' ? filename.slice(1) : filename);

/**
 * Makes the Pug engine.
 *
 * @param options `pug`, the module of `pug`; `options` of `pug.compile`, such as
 * `pretty`, `doctype`, `filters` or `plugins` (without resolve or read);
 * `extensions` (`['.pug']`).
 * @returns The engine.
 * @throws {TypeError} If `pug` is not Pug or an option is reserved.
 */
const createPugEngine = (options = {}) => {
  const pug = checkModule(
    options.pug,
    'compile',
    'createPugEngine needs pug: the module of the pug package.',
  );
  const given = checkEngineOptions(options.options, RESERVED, 'pug');
  const extensions = checkEngineExtensions(options.extensions, ['.pug']);
  return {
    name: 'pug',
    extensions,
    compile(source, context) {
      const loader = {
        resolve(filename, from) {
          const written = filename.trim();
          const relative = written[0] === '/' || written.startsWith('.') ? written : `./${written}`;
          const name = context.includes.join(nameOf(from ?? `/${context.name}`), relative);
          if (name === undefined) {
            throw new TemplateNotFoundError(written, [], { from: nameOf(from ?? context.name) });
          }
          return `/${name}`;
        },
        read(filename) {
          const name = nameOf(filename);
          const found = context.includes.readSync(name);
          if (found === undefined) {
            throw missingTemplate(name, context.name);
          }
          return found.source;
        },
      };
      return pug.compile(source, {
        ...given,
        filename: `/${context.name}`,
        basedir: '/',
        plugins: [loader, ...(given.plugins ?? [])],
      });
    },
  };
};

module.exports = { createPugEngine };
