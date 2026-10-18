// Not ported: the Mustache engine of ./templates, over the `mustache` the
// application passes in.  Each renderer has a writer of its own, whose cache
// of parsed templates is bounded, where `mustache.render` shares one without a
// bound for the process; a partial that is not there fails the render, where
// Mustache renders it as nothing; and a partial is looked up from the
// template it is written in, where Mustache tells its partials nothing of it.

const { createCache } = require('./cache.js');
const { perIncludes } = require('./environment.js');
const { checkEngineExtensions, checkModule } = require('./options.js');

// The parsed templates a writer keeps.
const MAX_PARSED = 1000;

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
  const tags = checkTags(options.tags);
  const extensions = checkEngineExtensions(options.extensions, ['.mustache']);
  const writerOf = perIncludes((includes) => {
    const writer = new mustache.Writer();
    // Mustache's renderPartial, but for the partials it is given, which are
    // the template they are written in: each partial renders its own with
    // the partials of its name.
    writer.renderPartial = function renderPartial(token, context, partials, config) {
      const found = includes.lookupSync(token[NAME], partials.from, extensions);
      let source = found.source;
      if (token[TAG_INDEX] === 0 && token[INDENTATION]) {
        source = this.indentPartial(source, token[INDENTATION], token[LINE_HAS_NON_SPACE]);
      }
      const tokens = this.parse(source, this.getConfigTags(config));
      return this.renderTokens(tokens, context, { from: found.name }, source, config);
    };
    const parsed = createCache(includes.cache ? MAX_PARSED : 0);
    // Mustache calls set and get; the renderer forgets a writer, not its cache.
    writer.templateCache = {
      set: (key, value) => parsed.set(key, value),
      get: (key) => parsed.get(key),
    };
    return writer;
  });
  return {
    name: 'mustache',
    extensions,
    compile(source, context) {
      const writer = writerOf(context.includes);
      // Parsed now, so that a syntax error is one of the compile.
      writer.parse(source, tags);
      const partials = { from: context.name };
      return (scope) => writer.render(source, scope, partials, tags);
    },
  };
};

module.exports = { createMustacheEngine };
