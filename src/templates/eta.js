// Not ported: the Eta engine of ./templates, over the `Eta` class the
// application passes in.  Its `resolvePath` and `readFile` are the loader's,
// so `include()` and `layout()` read nothing from disk, a name relative to the
// template it is written in; output is escaped, as Eta does by default.

const { createCache } = require('./cache.js');
const { missingTemplate, perIncludes } = require('./environment.js');
const {
  checkEngineExtensions,
  checkEngineOptions,
  checkEscaping,
  checkModule,
} = require('./options.js');

const RESERVED = new Set(['views', 'cache', 'cacheFilepaths', 'defaultExtension']);
// The options of Eta that turn off its escaping, or replace it.
const UNESCAPED = new Map([
  ['autoEscape', (value) => !value],
  ['escapeFunction', () => true],
]);

// A Cacher of Eta, which keeps every template it includes, as it renders,
// bounded as the caches of the renderer are.
const cacherOf = (maxEntries) => {
  const cache = createCache(maxEntries);
  return {
    define: (key, value) => cache.set(key, value),
    get: (key) => cache.get(key),
    remove: (key) => cache.delete(key),
    reset: () => cache.clear(),
    load(record) {
      for (const key of Object.keys(record)) cache.set(key, record[key]);
    },
  };
};

/**
 * Makes the Eta engine.
 *
 * @param options `Eta`, the `Eta` of `eta`; `options` of Eta, such as
 * `autoEscape` (true), `tags` or `varName`; `async` (false), to compile to
 * async functions for `await` and `includeAsync`; `extensions` (`['.eta']`).
 * @returns The engine.
 * @throws {TypeError} If `Eta` is not a class or an option is invalid.
 */
const createEtaEngine = (options = {}) => {
  const Eta = checkModule(
    options.Eta,
    undefined,
    'createEtaEngine needs Eta: the Eta of the eta package.',
  );
  const given = checkEngineOptions(options.options, RESERVED, 'eta');
  checkEscaping(options, given, UNESCAPED, 'eta');
  const async = options.async ?? false;
  if (typeof async !== 'boolean') throw new TypeError('async must be a boolean.');
  const extensions = checkEngineExtensions(options.extensions, ['.eta']);
  const instanceOf = perIncludes((includes) => {
    const eta = new Eta({ ...given, cache: includes.cache, cacheFilepaths: false });
    eta.templatesSync = cacherOf(includes.maxEntries);
    eta.templatesAsync = cacherOf(includes.maxEntries);
    eta.resolvePath = (template, resolveOptions) =>
      includes.lookupSync(template, resolveOptions?.filepath, extensions).name;
    eta.readFile = (name) => {
      const found = includes.readSync(name);
      if (found === undefined) throw missingTemplate(name);
      return found.source;
    };
    return eta;
  });
  return {
    name: 'eta',
    extensions,
    compile(source, context) {
      const eta = instanceOf(context.includes);
      const render = eta.compile(source, { async, filepath: context.name });
      return (scope) => render.call(eta, scope, { async, filepath: context.name });
    },
  };
};

module.exports = { createEtaEngine };
