// Not ported: how an engine reads the includes, partials and layouts of a
// template: through the loader of its renderer, so that they are checked and
// kept as its templates are, and never read from disk by the engine itself.

const { isTemplateError, TemplateLoadError, TemplateNotFoundError } = require('./errors.js');
const { checkTemplateName, isTemplateName, notTemplateName } = require('./loader.js');
const { createCache, memoize } = require('./cache.js');
const { hasExtension } = require('./environment.js');

// The segments of a name, `.` dropped and `..` taking the one before; undefined
// when `..` leads out of the root.
const normalize = (segments) => {
  const kept = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (kept.length === 0) return undefined;
      kept.pop();
    } else {
      kept.push(segment);
    }
  }
  const name = kept.join('/');
  return isTemplateName(name) ? name : undefined;
};

const directoryOf = (name) => {
  const slash = name.lastIndexOf('/');
  return slash === -1 ? '' : name.slice(0, slash);
};

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
  if (include[0] === '/') return normalize(include.split('/'));
  const relative = include.startsWith('./') || include.startsWith('../');
  if (!relative || from === undefined) return normalize(include.split('/'));
  return normalize(`${directoryOf(from)}/${include}`.split('/'));
};

// The names an include may be: as joined, then under each partials directory
// for a bare name; each with an extension of the engine unless it has one,
// then as it is.
const candidatesOf = (include, from, extensions, partials) => {
  const bases = [];
  const joined = joinName(from, include);
  if (joined !== undefined) bases.push(joined);
  const bare = include[0] !== '/' && !include.startsWith('./') && !include.startsWith('../');
  if (bare) {
    for (const directory of partials) {
      const name = joinName(undefined, `${directory}/${include}`);
      if (name !== undefined) bases.push(name);
    }
  }
  const names = [];
  for (const base of bases) {
    if (hasExtension(base, extensions)) {
      names.push(base);
      continue;
    }
    for (const extension of extensions) names.push(base + extension);
    if (!extensions.includes('')) names.push(base);
  }
  return names;
};

const READ = 'The name of a template read';

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
    async lookup(include, from, extensions = ['']) {
      spend();
      const depth = depths.of(include, from);
      const names = candidatesOf(include, from, extensions, partials);
      for (const name of names) {
        const source = await read(name);
        if (source === undefined) continue;
        depths.reached(source.name, depth);
        return source;
      }
      throw new TemplateNotFoundError(include, names, { from });
    },
    lookupSync(include, from, extensions = ['']) {
      spend();
      const depth = depths.of(include, from);
      const names = candidatesOf(include, from, extensions, partials);
      for (const name of names) {
        const source = readSync(name);
        if (source === undefined) continue;
        depths.reached(source.name, depth);
        return source;
      }
      throw new TemplateNotFoundError(include, names, { from });
    },
  });
  return { includes, top: depths.top };
};

module.exports = { createIncludes, joinName, withBounds };
