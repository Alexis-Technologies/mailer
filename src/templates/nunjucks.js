// Not ported: the Nunjucks engine of ./templates, over the `nunjucks` the
// application passes in.  A loader of the renderer's takes the place of
// Nunjucks's file system, for `extends`, `include` and `import`; output is
// escaped, as Nunjucks does by default.

const { TemplateNotFoundError } = require('./errors.js');
const {
  checkEngineExtensions,
  checkEngineOptions,
  checkFunctions,
  checkModule,
} = require('./options.js');
const { checkOptionalFunction } = require('../internal/options.js');

const isRelative = (name) => name.startsWith('./') || name.startsWith('../');

/**
 * Makes the Nunjucks engine.
 *
 * @param options `nunjucks`, the module of `nunjucks`; `options` of its
 * `Environment`, such as `autoescape` (true), `throwOnUndefined` or
 * `trimBlocks`; `filters`; `configure(env)`; `extensions`
 * (`['.njk', '.nunjucks']`).
 * @returns The engine.
 * @throws {TypeError} If `nunjucks` is not Nunjucks or an option is invalid.
 */
const createNunjucksEngine = (options = {}) => {
  const nunjucks = checkModule(
    options.nunjucks,
    'Environment',
    'createNunjucksEngine needs nunjucks: the module of the nunjucks package.',
  );
  checkModule(nunjucks.Template, undefined, 'nunjucks has no Template.');
  const given = checkEngineOptions(options.options, new Set(), 'nunjucks');
  const filters = checkFunctions(options.filters, 'filters');
  const configure = checkOptionalFunction(options.configure, 'configure');
  const extensions = checkEngineExtensions(options.extensions, ['.njk', '.nunjucks']);
  const environments = new WeakMap();
  const environmentOf = (includes) => {
    let state = environments.get(includes);
    if (state !== undefined) return state;
    // What a lookup failed with: Nunjucks rewraps the error of a loader into
    // a TemplateError of its text, which loses its class.
    const failures = [];
    const loader = {
      async: true,
      isRelative,
      resolve: (from, to) => includes.join(from, to) ?? to,
      // Nunjucks is told on a tick of its own, outside the promise, so that
      // what its callback throws is not taken for a failure of the lookup.
      getSource(name, callback) {
        includes.lookup(name, undefined, extensions).then(
          (found) =>
            process.nextTick(callback, null, {
              src: found.source,
              path: found.name,
              noCache: !includes.cache,
            }),
          (error) => {
            failures.push(error);
            process.nextTick(callback, error);
          },
        );
      },
    };
    const env = new nunjucks.Environment([loader], { autoescape: true, ...given });
    for (const name of Object.keys(filters)) env.addFilter(name, filters[name]);
    configure?.(env);
    state = { env, failures };
    environments.set(includes, state);
    return state;
  };
  return {
    name: 'nunjucks',
    extensions,
    compile(source, context) {
      const state = environmentOf(context.includes);
      const template = new nunjucks.Template(source, state.env, context.name, true);
      return (scope) =>
        new Promise((resolve, reject) => {
          const before = state.failures.length;
          template.render(scope, (error, output) => {
            if (error == null) {
              resolve(output ?? '');
              return;
            }
            // The failure of a lookup during this render, under the error
            // Nunjucks made of it.
            let failure;
            for (let index = before; index < state.failures.length; index++) {
              if (state.failures[index] instanceof TemplateNotFoundError) {
                failure = state.failures[index];
              }
            }
            state.failures.length = before;
            reject(failure === undefined ? error : Object.assign(error, { cause: failure }));
          });
        });
    },
  };
};

module.exports = { createNunjucksEngine };
