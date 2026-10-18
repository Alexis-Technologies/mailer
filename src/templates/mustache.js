// Not ported: the Mustache engine of ./templates, over the `mustache` the
// application passes in.  Each renderer has a writer of its own, where
// `mustache.render` shares one for the process, whose cache keeps what it
// parses by the whole source, without a bound: a template is parsed once as
// it is compiled, and a partial once per template the includes read, kept as
// long as they keep it.  A partial that is not there fails the render, where
// Mustache renders it as nothing; and a partial is looked up from the
// template it is written in, where Mustache tells its partials nothing of it.

const { perIncludes } = require('./environment.js');
const { checkEngineExtensions, checkModule } = require('./options.js');

// The fields of a partial's token in Mustache 4: its name, and the
// indentation of a standalone partial.
const NAME = 1;
const INDENTATION = 4;
const TAG_INDEX = 5;
const LINE_HAS_NON_SPACE = 6;

const checkTags = (tags) => {
  if (tags === undefined) return undefined;
  if (
    !Array.isArray(tags) ||
    tags.length !== 2 ||
    typeof tags[0] !== 'string' ||
    typeof tags[1] !== 'string'
  ) {
    throw new TypeError('tags must be two strings, such as ["<%", "%>"].');
  }
  return Object.freeze([...tags]);
};

/**
 * Makes the Mustache engine.
 *
 * @param options `mustache`, the module of `mustache`; `tags`; `extensions`
 * (`['.mustache']`).
 * @returns The engine.
 * @throws {TypeError} If `mustache` is not Mustache or an option is invalid.
 */
const createMustacheEngine = (options = {}) => {
  const mustache = checkModule(
    options.mustache,
    'Writer',
    'createMustacheEngine needs mustache: the module of the mustache package.',
  );
  checkModule(mustache.Context, undefined, 'mustache has no Context.');
  const tags = checkTags(options.tags);
  const extensions = checkEngineExtensions(options.extensions, ['.mustache']);
  const writerOf = perIncludes((includes) => {
    const writer = new mustache.Writer();
    // Mustache keeps nothing: the engine keeps the tokens.
    writer.templateCache = undefined;
    // The tokens of each partial, by the template the includes read, which
    // the WeakMap drops with it, and by its indentation, as Mustache indents
    // a standalone partial before it parses it.
    const parsed = new WeakMap();
    const tokensOf = (found, indentation, parse) => {
      let byIndentation = parsed.get(found);
      if (byIndentation === undefined) {
        byIndentation = new Map();
        parsed.set(found, byIndentation);
      }
      let tokens = byIndentation.get(indentation);
      if (tokens === undefined) {
        tokens = parse();
        byIndentation.set(indentation, tokens);
      }
      return tokens;
    };
    // Mustache's renderPartial, but for the partials it is given, which are
    // the template they are written in: each partial renders its own with
    // the partials of its name.
    writer.renderPartial = function renderPartial(token, context, partials, config) {
      const found = includes.lookupSync(token[NAME], partials.from, extensions);
      const standalone = token[TAG_INDEX] === 0 && Boolean(token[INDENTATION]);
      const source = standalone
        ? this.indentPartial(found.source, token[INDENTATION], token[LINE_HAS_NON_SPACE])
        : found.source;
      const indentation = standalone
        ? `${token[INDENTATION]}\u0000${token[LINE_HAS_NON_SPACE]}`
        : '';
      const tokens = tokensOf(found, indentation, () =>
        this.parse(source, this.getConfigTags(config)),
      );
      return this.renderTokens(tokens, context, { from: found.name }, source, config);
    };
    return writer;
  });
  return {
    name: 'mustache',
    extensions,
    compile(source, context) {
      const writer = writerOf(context.includes);
      // Parsed now, so that a syntax error is one of the compile, and once.
      const tokens = writer.parse(source, tags);
      const partials = { from: context.name };
      return (scope) =>
        writer.renderTokens(tokens, new mustache.Context(scope), partials, source, tags);
    },
  };
};

module.exports = { createMustacheEngine };
