// Not ported: the Handlebars engine of ./templates, over the `handlebars`
// the application passes in.  Each renderer has an environment of its own
// (`handlebars.create()`), where @nestjs-modules/mailer registered helpers and
// partials on the global one and read every partial again on each send; a
// template's partials are found in it as it is compiled, read through the
// loader once.

const {
  checkEngineExtensions,
  checkEngineOptions,
  checkEscaping,
  checkFunctions,
  checkModule,
} = require('./options.js');
const { checkOptionalFunction } = require('../internal/options.js');

const PARTIALS = new Set(['PartialStatement', 'PartialBlockStatement']);
// The options of compile that turn off its escaping.
const UNESCAPED = new Map([['noEscape', Boolean]]);

const partialNameOf = (name) => {
  if (name?.type === 'PathExpression') return name.original;
  if (name?.type === 'StringLiteral') return name.value;
  // A dynamic partial, `{{> (whichPartial)}}`, is named at render time.
  return undefined;
};

// The statements of a template that name a partial, and the partials it
// defines inline, from its AST.
const visit = (node, named, inline) => {
  if (Array.isArray(node)) {
    for (const child of node) visit(child, named, inline);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  if (PARTIALS.has(node.type)) {
    const name = partialNameOf(node.name);
    if (name !== undefined && name[0] !== '@') named.push(node);
  }
  if (node.type === 'DecoratorBlock' && node.path?.original === 'inline') {
    const name = node.params?.[0]?.value;
    if (typeof name === 'string') inline.add(name);
  }
  for (const key of Object.keys(node)) {
    if (key !== 'loc' && typeof node[key] === 'object') visit(node[key], named, inline);
  }
};

// Looks up the partials a template names from the template `from`, and names
// each in its AST by the template it resolves to, so that `./footer` in two
// directories is two partials.
const resolvePartials = async (includes, ast, from, extensions) => {
  const named = [];
  const inline = new Set();
  visit(ast, named, inline);
  const found = new Map();
  for (const node of named) {
    const name = partialNameOf(node.name);
    if (inline.has(name)) continue;
    const source = await includes.lookup(name, from, extensions);
    node.name = {
      type: 'StringLiteral',
      value: source.name,
      original: source.name,
      loc: node.name.loc,
    };
    found.set(source.name, source);
  }
  return found;
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
  checkEscaping(options, given, UNESCAPED, 'handlebars');
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
      environment = { env, partials: new Map() };
      environments.set(includes, environment);
    }
    return environment;
  };
  // Compiles and registers a partial once per environment however many
  // templates name it at once, under the name of its template, and gives the
  // partials it names, which it does not wait for: a partial that names
  // itself, or one that names it back, is registered all the same, as
  // Handlebars finds partials when it renders.
  const registerPartial = (environment, includes, source) => {
    let entry = environment.partials.get(source.name);
    if (entry === undefined) {
      entry = (async () => {
        const ast = environment.env.parse(source.source);
        const named = await resolvePartials(includes, ast, source.name, extensions);
        environment.env.registerPartial(source.name, environment.env.compile(ast, given));
        return named;
      })();
      environment.partials.set(source.name, entry);
      entry.catch(() => environment.partials.delete(source.name));
    }
    return entry;
  };
  // Registers the partials a template names, and those they name, each once.
  const loadPartials = async (environment, includes, ast, from) => {
    const pending = [await resolvePartials(includes, ast, from, extensions)];
    const seen = new Set();
    for (let index = 0; index < pending.length; index++) {
      for (const source of pending[index].values()) {
        if (seen.has(source.name)) continue;
        seen.add(source.name);
        pending.push(await registerPartial(environment, includes, source));
      }
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
