// Not ported: the Pug engine of ./templates, over the `pug` the application
// passes in.  A plugin of `resolve` and `read` takes the place of Pug's disk:
// `include` and `extends` are looked up through the loader as every engine's
// includes are, `/x` from its root, `./x` against the file it is written in,
// any other from the root, then the directories of partials, with the
// extensions of the engine.  Each template is compiled once, and its locals
// are the context alone, where @nestjs-modules/mailer rendered the file again
// on each send with the options of Pug mixed into them.

const path = require('node:path');
const { missingTemplate } = require('./environment.js');
const { checkEngineExtensions, checkEngineOptions, checkModule } = require('./options.js');

const RESERVED = new Set(['filename', 'basedir', 'cache']);

// Pug adds `.pug` to a path written without an extension before it resolves
// it: such a path is marked first, so that the extensions of the engine are
// tried in its place.
const BARE = '\u0000';
const ADDED = `${BARE}.pug`;

const markBare = (tokens) => {
  for (const token of tokens) {
    if (token.type === 'path' && path.extname(token.val) === '') token.val += BARE;
  }
  return tokens;
};

const writtenOf = (filename) => {
  const trimmed = filename.trim();
  return trimmed.endsWith(ADDED) ? trimmed.slice(0, -ADDED.length) : trimmed;
};

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
      const { includes } = context;
      const loader = {
        postLex: markBare,
        resolve: (filename, from) =>
          `/${includes.lookupSync(writtenOf(filename), nameOf(from ?? context.name), extensions).name}`,
        read(filename) {
          const name = nameOf(filename);
          const found = includes.readSync(name);
          if (found === undefined) throw missingTemplate(name, context.name);
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
