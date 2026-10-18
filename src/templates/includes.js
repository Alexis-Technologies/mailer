// Not ported: how an engine reads the includes, partials and layouts of a
// template: through the loader of its renderer, so that they are checked and
// kept as its templates are, and never read from disk by the engine itself.

const { isTemplateError, TemplateLoadError, TemplateNotFoundError } = require('./errors.js');
const { checkTemplateName, isTemplateName, notTemplateName } = require('./loader.js');
const { createCache, memoize } = require('./cache.js');
const { hasExtension } = require('./environment.js');

// The name a path stands for, its segments read in one pass, `.` dropped and
// `..` taking the one before; undefined when `..` leads out of the root.
const normalize = (written) => {
  let name = '';
  let start = 0;
  for (;;) {
    const slash = written.indexOf('/', start);
    const segment = written.slice(start, slash === -1 ? written.length : slash);
    if (segment === '..') {
      if (name === '') return undefined;
      const last = name.lastIndexOf('/');
      name = last === -1 ? '' : name.slice(0, last);
    } else if (segment !== '' && segment !== '.') {
      name = name === '' ? segment : `${name}/${segment}`;
    }
    if (slash === -1) break;
    start = slash + 1;
  }
  return isTemplateName(name) ? name : undefined;
};

const directoryOf = (name) => {
  const slash = name.lastIndexOf('/');
  return slash === -1 ? '' : name.slice(0, slash);
};

const isRelative = (include) => include.startsWith('./') || include.startsWith('../');

/**
 * The name an include stands for in a template: `./x` and `../x` against the
 * directory of `from`, `/x` from the root, any other as it is.
 *
 * @param from The name of the including template, if known.
 * @param include The name it includes.
 * @returns The name, or `undefined` when it leads out of the root.
 * @internal
 */
const joinName = (from, include) => {
  if (typeof include !== 'string' || include === '') return undefined;
  if (include[0] === '/' || !isRelative(include) || from === undefined) return normalize(include);
  return normalize(`${directoryOf(from)}/${include}`);
};

// The names a base may be: itself when it has an extension of the engine,
// else with each of them, then as it is.
const namesOf = function* (base, extensions) {
  if (hasExtension(base, extensions)) {
    yield base;
    return;
  }
  let empty = false;
  for (const extension of extensions) {
    if (extension === '') empty = true;
    yield base + extension;
  }
  if (!empty) yield base;
};

// The names an include may be, in the order they are tried: as joined, then
// under each directory of partials for a bare name, as they are tried, so
// that the first found ends the lookup.
const candidatesOf = function* (include, from, extensions, partials) {
  const joined = joinName(from, include);
  if (joined !== undefined) yield* namesOf(joined, extensions);
  if (include[0] === '/' || isRelative(include)) return;
  for (const directory of partials) {
    const name = joinName(undefined, `${directory}/${include}`);
    if (name !== undefined) yield* namesOf(name, extensions);
  }
};

// The names tried, for the error of an include that is not found.
const triedOf = (include, from, extensions, partials) => {
  const tried = [];
  for (const name of candidatesOf(include, from, extensions, partials)) tried.push(name);
  return tried;
};

const READ = 'The name of a template read';
// A lookup of a name as it is.
const NO_EXTENSIONS = Object.freeze(['']);

// What a loader threw, as an error that names the template: one of
// ./templates as it is, and any other, such as EMFILE or a database timeout,
// as a TemplateLoadError, which an engine that wraps it does not make a
// failure of the template, as it may pass on another attempt.
const loadFailure = (name, error) =>
  isTemplateError(error) ? error : new TemplateLoadError(name, { cause: error });

// The bounds of the render whose engine runs now, synchronously: set around
// each call of an engine, so that the includes it looks up before it returns
// are counted against that render.  What an engine looks up in a continuation
// of its own, after an await, is not counted, as no render is running then.
let current;

/**
 * Calls an engine with the bounds of a render.
 *
 * @param bounds `{ includes, maxIncludes }`: the includes read so far.
 * @param step The call of the engine.
 * @returns What it gives.
 * @internal
 */
const withBounds = (bounds, step) => {
  const outer = current;
  current = bounds;
  try {
    return step();
  } finally {
    current = outer;
  }
};

const spend = () => {
  if (current === undefined) return;
  current.includes++;
  if (current.includes > current.maxIncludes) {
    throw new RangeError(
      `The render reads more than ${current.maxIncludes} includes (maxIncludes).`,
    );
  }
};

// The reads of a loader, kept while the cache is on.  A loader is given
// template names alone, whoever asks: an engine, or the variants of the
// renderer; and it is told when to stop: at the timeout of a read, which
// renders that wait for it share, or when the one render it is for is
// aborted.
const readsOf = (loader, options) => {
  const sources = createCache(options.cache ? options.maxEntries : 0);
  const syncSources = createCache(options.cache ? options.maxEntries : 0);
  const signalOf = (timeout) => {
    if (options.signal === undefined) return timeout;
    return timeout === undefined ? options.signal : AbortSignal.any([timeout, options.signal]);
  };
  const read = (name) => {
    if (!isTemplateName(name)) return Promise.reject(notTemplateName(name, READ));
    return memoize(
      sources,
      name,
      async (timeout) => {
        try {
          return (await loader.load(name, { signal: signalOf(timeout) })) ?? undefined;
        } catch (error) {
          throw loadFailure(name, error);
        }
      },
      options.timeoutMilliseconds,
    );
  };
  const readSync = (name) => {
    checkTemplateName(name, READ);
    if (typeof loader.loadSync !== 'function') {
      throw new TypeError(
        'This engine reads its includes synchronously, and the loader has no loadSync.',
      );
    }
    const kept = syncSources.get(name);
    if (kept !== undefined) return kept.source;
    let source;
    try {
      source = loader.loadSync(name) ?? undefined;
    } catch (error) {
      throw loadFailure(name, error);
    }
    syncSources.set(name, { source });
    return source;
  };
  return { read, readSync };
};

// How many includes deep each template is, at least, as an include is
// written in a template: a chain of them deeper than maxIncludeDepth is
// refused, and a template that includes itself is as deep as before.
const depthsOf = (options) => {
  const { maxIncludeDepth } = options;
  const depths = createCache(options.maxEntries);
  return {
    of(include, from) {
      const depth = (from === undefined ? 0 : (depths.get(from) ?? 0)) + 1;
      if (depth > maxIncludeDepth) {
        throw new RangeError(
          `The include ${JSON.stringify(include)} of ${from} is more than ${maxIncludeDepth} ` +
            'includes deep (maxIncludeDepth).',
        );
      }
      return depth;
    },
    reached(name, depth) {
      const known = depths.get(name);
      if (known === undefined || depth < known) depths.set(name, depth);
    },
    top: (name) => depths.set(name, 0),
  };
};

/**
 * Makes the includes of a renderer: the reads of its loader, kept while its
 * cache is on, and the lookup of a name an engine includes.
 *
 * @param loader The loader of the renderer.
 * @param options `partials`, the directories searched by a bare name after the
 * root, `cache`, `maxEntries`, `maxIncludeDepth`, `timeoutMilliseconds`, after
 * which a read that hangs is aborted and read anew, and `signal`, that of the
 * one render the includes are for, without a cache.
 * @returns `{ includes, top }`: the includes, one object per renderer and per
 * `clear()`, and the mark of a template the renderer compiles itself, which
 * is no include deep.
 * @internal
 */
const createIncludes = (loader, options) => {
  const { partials } = options;
  const { read, readSync } = readsOf(loader, options);
  const depths = depthsOf(options);
  const includes = Object.freeze({
    partials,
    cache: options.cache,
    maxEntries: options.maxEntries,
    join: joinName,
    read,
    readSync,
    async lookup(include, from, extensions = NO_EXTENSIONS) {
      spend();
      const depth = depths.of(include, from);
      for (const name of candidatesOf(include, from, extensions, partials)) {
        const source = await read(name);
        if (source === undefined) continue;
        depths.reached(source.name, depth);
        return source;
      }
      throw new TemplateNotFoundError(include, triedOf(include, from, extensions, partials), {
        from,
      });
    },
    lookupSync(include, from, extensions = NO_EXTENSIONS) {
      spend();
      const depth = depths.of(include, from);
      for (const name of candidatesOf(include, from, extensions, partials)) {
        const source = readSync(name);
        if (source === undefined) continue;
        depths.reached(source.name, depth);
        return source;
      }
      throw new TemplateNotFoundError(include, triedOf(include, from, extensions, partials), {
        from,
      });
    },
  });
  return { includes, top: depths.top };
};

module.exports = { createIncludes, joinName, withBounds };
