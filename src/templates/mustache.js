// Not ported: the Mustache engine of ./templates, over the `mustache` the
// application passes in.  Each renderer has a writer of its own, whose cache
// of parsed templates is bounded, where `mustache.render` shares one without a
// bound for the process; and a partial that is not there fails the render,
// where Mustache renders it as nothing.

const { createCache } = require('./cache.js');
const { checkEngineExtensions, checkModule } = require('./options.js');

// The parsed templates a writer keeps.
const MAX_PARSED = 1000;

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
  const writers = new WeakMap();
  const writerOf = (includes) => {
    let writer = writers.get(includes);
    if (writer === undefined) {
      writer = new mustache.Writer();
      const parsed = createCache(includes.cache ? MAX_PARSED : 0);
      // Mustache calls set and get; the renderer forgets a writer, not its cache.
      writer.templateCache = {
        set: (key, value) => parsed.set(key, value),
        get: (key) => parsed.get(key),
      };
      writers.set(includes, writer);
    }
    return writer;
  };
  return {
    name: 'mustache',
    extensions,
    compile(source, context) {
      const writer = writerOf(context.includes);
      // Parsed now, so that a syntax error is one of the compile.
      writer.parse(source, tags);
      const partials = (name) => context.includes.lookupSync(name, undefined, extensions).source;
      return (scope) => writer.render(source, scope, partials, tags);
    },
  };
};

module.exports = { createMustacheEngine };
