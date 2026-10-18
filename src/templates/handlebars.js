// Not ported: the Handlebars engine of ./templates, over the `handlebars`
// the application passes in.  Each renderer has an environment of its own
// (`handlebars.create()`), where @nestjs-modules/mailer registered helpers and
// partials on the global one and read every partial again on each send; a
// template's partials are found in it as it is compiled, read through the
// loader once.

const {
  checkEngineExtensions,
  checkEngineOptions,
  checkFunctions,
  checkModule,
} = require('./options.js');
const { checkOptionalFunction } = require('../internal/options.js');

const PARTIALS = new Set(['PartialStatement', 'PartialBlockStatement']);

const partialNameOf = (name) => {
  if (name?.type === 'PathExpression') return name.original;
  if (name?.type === 'StringLiteral') return name.value;
  // A dynamic partial, `{{> (whichPartial)}}`, is named at render time.
  return undefined;
};

// The partials a template names, and those it defines inline, from its AST.
const visit = (node, named, inline) => {
  if (Array.isArray(node)) {
    for (const child of node) visit(child, named, inline);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  if (PARTIALS.has(node.type)) {
    const name = partialNameOf(node.name);
    if (name !== undefined && name[0] !== '@') named.add(name);
  }
  if (node.type === 'DecoratorBlock' && node.path?.original === 'inline') {
    const name = node.params?.[0]?.value;
    if (typeof name === 'string') inline.add(name);
  }
  for (const key of Object.keys(node)) {
    if (key !== 'loc' && typeof node[key] === 'object') visit(node[key], named, inline);
  }
};

/**
 * Makes the Handlebars engine.
 *
 * @param options `handlebars`, the module of `handlebars`; `helpers`; `options`
 * of its `compile`, such as `strict` or `knownHelpersOnly`; `configure(env)`,
 * called with each environment the engine makes; `extensions`
 * (`['.hbs', '.handlebars']`).
 * @returns The engine.
 * @throws {TypeError} If `handlebars` is not Handlebars or an option is
 * invalid.
 */
const createHandlebarsEngine = (options = {}) => {
  const handlebars = checkModule(
    options.handlebars,
    'create',
    'createHandlebarsEngine needs handlebars: the module of the handlebars package.',
  );
  const helpers = checkFunctions(options.helpers, 'helpers');
  const given = checkEngineOptions(options.options, new Set(), 'handlebars');
  const configure = checkOptionalFunction(options.configure, 'configure');
  const extensions = checkEngineExtensions(options.extensions, ['.hbs', '.handlebars']);
  // The environment of each renderer, keyed by its includes: a new one after
  // clear(), and for each render without a cache.
  const environments = new WeakMap();
  const environmentOf = (includes) => {
    let environment = environments.get(includes);
    if (environment === undefined) {
      const env = handlebars.create();
      for (const name of Object.keys(helpers)) env.registerHelper(name, helpers[name]);
      configure?.(env);
      environment = { env, loading: new Map() };
      environments.set(includes, environment);
    }
    return environment;
  };
  // Reads, compiles and registers a partial and the partials it names, once
  // per environment however many templates name it at once.
  const loadPartial = (environment, includes, name, from) => {
    let loading = environment.loading.get(name);
    if (loading === undefined) {
      loading = (async () => {
        const found = await includes.lookup(name, from, extensions);
        const ast = environment.env.parse(found.source);
        await loadPartials(environment, includes, ast, found.name);
        environment.env.registerPartial(name, environment.env.compile(ast, given));
      })();
      environment.loading.set(name, loading);
      loading.catch(() => environment.loading.delete(name));
    }
    return loading;
  };
  const loadPartials = async (environment, includes, ast, from) => {
    const named = new Set();
    const inline = new Set();
    visit(ast, named, inline);
    for (const name of named) {
      if (!inline.has(name)) await loadPartial(environment, includes, name, from);
    }
  };
  return {
    name: 'handlebars',
    extensions,
    async compile(source, context) {
      const environment = environmentOf(context.includes);
      const ast = environment.env.parse(source);
      await loadPartials(environment, context.includes, ast, context.name);
      const template = environment.env.compile(ast, given);
      return (scope) => template(scope);
    },
  };
};

module.exports = { createHandlebarsEngine };
