// Not ported: the Liquid engine of ./templates, over the `Liquid` class of
// liquidjs the application passes in.  A file system of the loader takes the
// place of liquidjs's disk, for `include`, `render` and `layout`; and output
// is escaped by default, where liquidjs escapes nothing unless told.

const { TemplateNotFoundError } = require('./errors.js');
const {
  checkEngineExtensions,
  checkEngineOptions,
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

// A name no loader has: where a reference leads out of the root.
const NOWHERE = '\u0000';

/**
 * Makes the Liquid engine.
 *
 * @param options `Liquid`, the `Liquid` of `liquidjs`; `options` of
 * liquidjs, such as `strictVariables`, `ownPropertyOnly` (true) or
 * `outputEscape` ('escape'); `filters`; `configure(liquid)`; `extensions`
 * (`['.liquid']`).
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
  const filters = checkFunctions(options.filters, 'filters');
  const configure = checkOptionalFunction(options.configure, 'configure');
  const extensions = checkEngineExtensions(options.extensions, ['.liquid']);
  const instances = new WeakMap();
  const instanceOf = (includes) => {
    let liquid = instances.get(includes);
    if (liquid !== undefined) return liquid;
    const source = async (name) => (await includes.read(name))?.source;
    const fs = {
      sep: '/',
      async exists(name) {
        return name !== NOWHERE && (await includes.read(name)) !== undefined;
      },
      existsSync: (name) => name !== NOWHERE && includes.readSync(name) !== undefined,
      async readFile(name) {
        const text = await source(name);
        if (text === undefined) throw new TemplateNotFoundError(name, [name]);
        return text;
      },
      readFileSync(name) {
        const found = includes.readSync(name);
        if (found === undefined) throw new TemplateNotFoundError(name, [name]);
        return found.source;
      },
      resolve(dir, file, extname) {
        const relative = dir === '' ? file : `${dir}/${file}`;
        const name = includes.join(undefined, `/${relative}`);
        if (name === undefined) return NOWHERE;
        return name.lastIndexOf('.') > name.lastIndexOf('/') ? name : name + extname;
      },
      dirname(name) {
        const slash = name.lastIndexOf('/');
        return slash === -1 ? '' : name.slice(0, slash);
      },
      contains: () => true,
    };
    liquid = new Liquid({
      outputEscape: 'escape',
      ownPropertyOnly: true,
      ...given,
      root: [''],
      partials: ['', ...includes.partials],
      layouts: ['', ...includes.partials],
      extname: extensions[0],
      relativeReference: true,
      fs,
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
      const template = liquid.parse(source, context.name);
      return async (scope) => String(await liquid.render(template, scope));
    },
  };
};

module.exports = { createLiquidEngine };
