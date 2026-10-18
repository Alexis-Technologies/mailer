// Not ported: the Liquid engine of ./templates, over the `Liquid` class of
// liquidjs the application passes in.  A file system of the loader takes the
// place of liquidjs's disk, for `include`, `render` and `layout`; and output
// is escaped by default, where liquidjs escapes nothing unless told.

const { TemplateNotFoundError } = require('./errors.js');
const {
  checkEngineExtensions,
  checkEngineOptions,
  checkEscaping,
  checkFunctions,
  checkModule,
} = require('./options.js');
const { checkOptionalFunction } = require('../internal/options.js');

const RESERVED = new Set([
  'root',
  'partials',
  'layouts',
  'fs',
  'extname',
  'relativeReference',
  'templates',
  'cache',
]);

// The limits of liquidjs, which has none of its own: the characters of a
// template parsed, as many as the file loader reads; the milliseconds of a
// render, which liquidjs checks as it goes, so that a loop of a template stops
// where no timeout can stop it; and what a render may allocate, in liquidjs's
// units (characters, and the items of a range).
const LIMITS = Object.freeze({ parseLimit: 1024 * 1024, renderLimit: 1000, memoryLimit: 1e8 });

// The options of liquidjs that turn off its escaping, or replace it.
const UNESCAPED = new Map([['outputEscape', (value) => value !== 'escape']]);

// A name no loader has: where a reference leads out of the root, and, before
// the name written, where liquidjs looks last for a template it did not find.
const NOWHERE = '\u0000';

const isMissing = (name) => name.length > 1 && name[0] === NOWHERE;

// liquidjs keeps the error it wraps as `originalError`: it is made the cause,
// so that the renderer finds a missing include or a loader's failure in it.
const withCauses = (error) => {
  let current = error;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    if (current.cause === undefined && current.originalError !== undefined) {
      Object.defineProperty(current, 'cause', {
        value: current.originalError,
        configurable: true,
        writable: true,
      });
    }
    current = current.cause;
  }
  return error;
};

// The file system of liquidjs over the includes of a renderer.
const fileSystemOf = (includes, roots, extname) => {
  const resolve = (dir, file, extension) => {
    const relative = dir === '' ? file : `${dir}/${file}`;
    const name = includes.join(undefined, `/${relative}`);
    if (name === undefined) return NOWHERE;
    return name.lastIndexOf('.') > name.lastIndexOf('/') ? name : name + extension;
  };
  // The template liquidjs did not find, by the names it looked up.
  const missing = (name) => {
    const file = name.slice(1);
    const tried = [];
    for (const root of roots) {
      const candidate = resolve(root, file, extname);
      if (candidate !== NOWHERE) tried.push(candidate);
    }
    return new TemplateNotFoundError(file, tried);
  };
  return {
    sep: '/',
    async exists(name) {
      if (name[0] === NOWHERE) return isMissing(name);
      return (await includes.read(name)) !== undefined;
    },
    existsSync(name) {
      if (name[0] === NOWHERE) return isMissing(name);
      return includes.readSync(name) !== undefined;
    },
    async readFile(name) {
      if (isMissing(name)) throw missing(name);
      const found = await includes.read(name);
      if (found === undefined) throw new TemplateNotFoundError(name, [name]);
      return found.source;
    },
    readFileSync(name) {
      if (isMissing(name)) throw missing(name);
      const found = includes.readSync(name);
      if (found === undefined) throw new TemplateNotFoundError(name, [name]);
      return found.source;
    },
    resolve,
    // Tried after every directory, so that a template not found is told by
    // the name written, rather than by liquidjs's ENOENT.
    fallback: (file) => NOWHERE + file,
    dirname(name) {
      const slash = name.lastIndexOf('/');
      return slash === -1 ? '' : name.slice(0, slash);
    },
    contains: () => true,
  };
};

/**
 * Makes the Liquid engine.
 *
 * @param options `Liquid`, the `Liquid` of `liquidjs`; `options` of
 * liquidjs, such as `strictVariables`, `ownPropertyOnly` (true),
 * `outputEscape` ('escape'), `parseLimit` (1 MiB), `renderLimit` (1000 ms) or
 * `memoryLimit` (1e8); `filters`; `configure(liquid)`; `extensions`
 * (`['.liquid']`); `allowUnescaped`.
 * @returns The engine.
 * @throws {TypeError} If `Liquid` is not a class or an option is reserved.
 */
const createLiquidEngine = (options = {}) => {
  const Liquid = checkModule(
    options.Liquid,
    undefined,
    'createLiquidEngine needs Liquid: the Liquid of the liquidjs package.',
  );
  const given = checkEngineOptions(options.options, RESERVED, 'liquid');
  checkEscaping(options, given, UNESCAPED, 'liquid');
  const filters = checkFunctions(options.filters, 'filters');
  const configure = checkOptionalFunction(options.configure, 'configure');
  const extensions = checkEngineExtensions(options.extensions, ['.liquid']);
  const instances = new WeakMap();
  const instanceOf = (includes) => {
    let liquid = instances.get(includes);
    if (liquid !== undefined) return liquid;
    const roots = ['', ...includes.partials];
    liquid = new Liquid({
      outputEscape: 'escape',
      ownPropertyOnly: true,
      ...LIMITS,
      ...given,
      root: [''],
      partials: roots,
      layouts: roots,
      extname: extensions[0],
      relativeReference: true,
      fs: fileSystemOf(includes, roots, extensions[0]),
      cache: includes.cache,
    });
    for (const name of Object.keys(filters)) liquid.registerFilter(name, filters[name]);
    configure?.(liquid);
    instances.set(includes, liquid);
    return liquid;
  };
  return {
    name: 'liquid',
    extensions,
    compile(source, context) {
      const liquid = instanceOf(context.includes);
      let template;
      try {
        template = liquid.parse(source, context.name);
      } catch (error) {
        throw withCauses(error);
      }
      return async (scope) => {
        try {
          return String(await liquid.render(template, scope));
        } catch (error) {
          throw withCauses(error);
        }
      };
    },
  };
};

module.exports = { createLiquidEngine };
