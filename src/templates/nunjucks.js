// Not ported: the Nunjucks engine of ./templates, over the `nunjucks` the
// application passes in.  A loader of the renderer's takes the place of
// Nunjucks's file system, for `extends`, `include` and `import`; output is
// escaped, as Nunjucks does by default.

const { createCache } = require('./cache.js');
const { TemplateNotFoundError } = require('./errors.js');
const {
  checkEngineExtensions,
  checkEngineOptions,
  checkEscaping,
  checkFunctions,
  checkModule,
} = require('./options.js');
const { checkOptionalFunction } = require('../internal/options.js');
const { perIncludes } = require('./environment.js');

const isRelative = (name) => name.startsWith('./') || name.startsWith('../');

// The options of the Environment that turn off its escaping: a falsy
// `autoescape`, null and undefined keeping the default.
const UNESCAPED = new Map([['autoescape', (value) => value != null && !value]]);

// What Nunjucks says of a template no loader has.
const NOT_FOUND = 'template not found: ';
// The failed lookups an environment keeps, to tell which names were tried.
const MAX_FAILURES = 1000;

// The template Nunjucks found missing, by its error, whose message ends a
// line with `template not found: <name>`: the error is made anew, without
// the cause, unless `dev` is on.
const missingOf = (error, failures) => {
  let current = error;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    const { message } = current;
    const at = typeof message === 'string' ? message.lastIndexOf(NOT_FOUND) : -1;
    if (at !== -1) {
      const start = at + NOT_FOUND.length;
      const end = message.indexOf('\n', start);
      const name = message.slice(start, end === -1 ? message.length : end);
      const failure = failures.get(name);
      return new TemplateNotFoundError(name, failure?.tried ?? [name], { cause: error });
    }
    current = current.cause;
  }
  return undefined;
};

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
  checkEscaping(options, given, UNESCAPED, 'nunjucks');
  const filters = checkFunctions(options.filters, 'filters');
  const configure = checkOptionalFunction(options.configure, 'configure');
  const extensions = checkEngineExtensions(options.extensions, ['.njk', '.nunjucks']);
  const environmentOf = perIncludes((includes) => {
    // The lookups that found nothing, by name: Nunjucks is told there is no
    // such template, which it fails on itself unless `ignore missing`, and
    // its error names the template, so each render finds its own.
    const failures = createCache(MAX_FAILURES);
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
            if (!(error instanceof TemplateNotFoundError)) {
              process.nextTick(callback, error);
              return;
            }
            failures.set(name, error);
            process.nextTick(callback, null, null);
          },
        );
      },
    };
    // `dev` keeps the error Nunjucks wraps as its cause, such as a loader's.
    const env = new nunjucks.Environment([loader], { autoescape: true, dev: true, ...given });
    for (const name of Object.keys(filters)) env.addFilter(name, filters[name]);
    configure?.(env);
    return { env, failures };
  });
  return {
    name: 'nunjucks',
    extensions,
    compile(source, context) {
      const state = environmentOf(context.includes);
      const template = new nunjucks.Template(source, state.env, context.name, true);
      return (scope) =>
        new Promise((resolve, reject) => {
          template.render(scope, (error, output) => {
            if (error == null) resolve(output ?? '');
            else reject(missingOf(error, state.failures) ?? error);
          });
        });
    },
  };
};

module.exports = { createNunjucksEngine };
