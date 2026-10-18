// Not ported: a renderer of templates by name, over an engine the
// application passes in: their variants by locale and part (the HTML, the
// text, the subject), their front matter and layout, CSS inlined, the text
// derived from the HTML, each template compiled once.  It is a `Renderer` of
// ./render, so `renderContent` and `renderFields` take it, as the worker of
// ./queue does.

const { htmlToText } = require('../render/html-to-text.js');
const { decodeEntities } = require('../render/entities.js');
const { messageOf } = require('../internal/decorator.js');
const { checkOptionalFunction, checkPositiveInteger } = require('../internal/options.js');
const { abortReason } = require('../internal/abort.js');
const { createLog } = require('../internal/log.js');
const { timerMs } = require('../internal/sleep.js');
const { createCache, hasTimeout, memoize } = require('./cache.js');
const {
  forRender,
  inPhase,
  TemplateNotFoundError,
  TemplateRenderError,
  templateErrorOf,
} = require('./errors.js');
const { parseFrontMatter } = require('./front-matter.js');
const { createIncludes, withBounds } = require('./includes.js');
const { checkTemplateName } = require('./loader.js');

const DEFAULT_MAX_ENTRIES = 1000;
// The bounds of a render: the includes it reads, how deep they go, and the
// bytes of each part it gives.
const DEFAULT_MAX_INCLUDES = 10_000;
const DEFAULT_MAX_INCLUDE_DEPTH = 32;
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
// How long a render may take; what it waits for after that, a read or a
// compile, is made anew by the next render rather than waited for.
const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
const NO_LAYOUT = new Set(['none', 'false']);

const defaultVariantName = (template, variant) => {
  const locale = variant.locale === undefined ? '' : `.${variant.locale}`;
  const part = variant.part === 'html' ? '' : `.${variant.part}`;
  return `${template}${locale}${part}`;
};

const checkEngine = (engine, what) => {
  if (typeof engine !== 'object' || engine === null || typeof engine.compile !== 'function') {
    throw new TypeError(`${what} must be a template engine, with compile().`);
  }
  if (typeof engine.name !== 'string' || engine.name === '') {
    throw new TypeError(`${what} must have a name.`);
  }
  if (!Array.isArray(engine.extensions)) throw new TypeError(`${what} must list its extensions.`);
  return engine;
};

// The engines of the renderer, each with the extensions it is found by, the
// longest first, so that `.mjml.hbs` wins over `.hbs`.
const enginesOf = (options) => {
  if (options.engine !== undefined && options.engines !== undefined) {
    throw new TypeError('A template renderer takes engine or engines, not both.');
  }
  const given = options.engines ?? (options.engine === undefined ? [] : [options.engine]);
  if (!Array.isArray(given) || given.length === 0) {
    throw new TypeError('A template renderer needs an engine.');
  }
  const engines = [];
  const suffixes = [];
  const seen = new Set();
  let bare = 0;
  for (const engine of given) {
    checkEngine(engine, `The engine ${engines.length + 1}`);
    if (engine.extensions.length === 0) bare++;
    for (const extension of engine.extensions) {
      if (seen.has(extension)) throw new TypeError(`Two engines take ${extension}.`);
      seen.add(extension);
      suffixes.push({ extension, engine });
    }
    engines.push(engine);
  }
  if (bare > 0 && engines.length > 1) {
    throw new TypeError('An engine without extensions must be the only one of its renderer.');
  }
  suffixes.sort((a, b) => b.extension.length - a.extension.length);
  return { engines, suffixes };
};

// A whole number above zero, or Infinity for none.
const checkBound = (value, name, fallback) => {
  if (value === undefined) return fallback;
  if (value !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(value) || value < 1)) {
    throw new TypeError(`${name} must be a positive whole number or Infinity: ${String(value)}`);
  }
  return value;
};

// 0 and Infinity mean no timeout, as for the transports.
const checkTimeout = (value) => {
  if (value === undefined) return DEFAULT_RENDER_TIMEOUT_MS;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new TypeError(`renderTimeoutMilliseconds must be a non-negative number: ${value}`);
  }
  return value;
};

const checkLocale = (locale, what) => {
  if (locale === undefined) return undefined;
  if (typeof locale !== 'string') throw new TypeError(`${what} must be a string.`);
  return Intl.getCanonicalLocales(locale)[0];
};

// The locales templates are written in, when the application names them: a
// locale asked for is looked up as the first of them its subtags reach, so
// that a locale a user chose keeps no entry of its own in the cache.
const checkLocales = (locales) => {
  if (locales === undefined) return undefined;
  if (!Array.isArray(locales)) throw new TypeError('locales must be an array of BCP 47 tags.');
  const set = new Set();
  for (const locale of locales) set.add(checkLocale(locale, 'A locale of locales'));
  return set;
};

const allowedLocale = (config, locale) => {
  if (config.locales === undefined || locale === undefined) return locale;
  let current = locale;
  for (;;) {
    if (config.locales.has(current)) return current;
    const dash = current.lastIndexOf('-');
    if (dash === -1) return undefined;
    current = current.slice(0, dash);
  }
};

const createRendererConfig = (options) => {
  const { engines, suffixes } = enginesOf(options);
  const loader = options.loader ?? (engines.length === 1 ? engines[0].loader : undefined);
  if (typeof loader?.load !== 'function') {
    throw new TypeError('A template renderer needs a loader, such as createFileLoader().');
  }
  const partials = options.partials ?? [];
  if (!Array.isArray(partials)) throw new TypeError('partials must be an array of names.');
  for (const directory of partials) checkTemplateName(directory, 'A directory of partials');
  if (options.layout !== undefined) {
    checkTemplateName(options.layout, 'layout');
    // A layout wraps the HTML a template gives as text: one whose engine
    // gives its parts at once would go without it.
    for (const engine of engines) {
      if (engine.parts === true) {
        throw new TypeError(
          `The ${engine.name} engine gives its parts at once, which no layout wraps: ` +
            'give it a renderer without one.',
        );
      }
    }
  }
  const globals = options.globals;
  if (globals !== undefined && typeof globals !== 'function' && typeof globals !== 'object') {
    throw new TypeError('globals must be an object or a function.');
  }
  for (const name of ['frontMatter', 'autoText']) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean') {
      throw new TypeError(`${name} must be a boolean.`);
    }
  }
  const cache = options.cache ?? true;
  if (typeof cache !== 'boolean' && (typeof cache !== 'object' || cache === null)) {
    throw new TypeError('cache must be a boolean or { maxEntries }.');
  }
  const maxEntries = checkPositiveInteger(
    (typeof cache === 'object' ? cache.maxEntries : undefined) ?? DEFAULT_MAX_ENTRIES,
    'cache.maxEntries',
  );
  return {
    engines,
    suffixes,
    loader,
    partials: Object.freeze([...partials]),
    layout: options.layout,
    globals,
    defaultLocale: checkLocale(options.defaultLocale, 'defaultLocale'),
    locales: checkLocales(options.locales),
    variantName: checkOptionalFunction(options.variantName, 'variantName') ?? defaultVariantName,
    frontMatter: options.frontMatter ?? true,
    inlineCss: checkOptionalFunction(options.inlineCss, 'inlineCss'),
    autoText: options.autoText ?? true,
    cache: cache !== false,
    maxEntries,
    maxIncludes: checkBound(options.maxIncludes, 'maxIncludes', DEFAULT_MAX_INCLUDES),
    maxIncludeDepth: checkBound(
      options.maxIncludeDepth,
      'maxIncludeDepth',
      DEFAULT_MAX_INCLUDE_DEPTH,
    ),
    maxOutputBytes: checkBound(options.maxOutputBytes, 'maxOutputBytes', DEFAULT_MAX_OUTPUT_BYTES),
    renderTimeoutMilliseconds: checkTimeout(options.renderTimeoutMilliseconds),
    log: createLog(options.logger, { component: 'templates' }),
  };
};

// The locales a template is looked up in: the one asked for, its subtags
// dropped from the end, then the default one so, then none.
const localeChain = (locale, defaultLocale) => {
  const chain = [];
  const add = (tag) => {
    if (tag === undefined) return;
    let current = tag;
    for (;;) {
      if (!chain.includes(current)) chain.push(current);
      const dash = current.lastIndexOf('-');
      if (dash === -1) break;
      current = current.slice(0, dash);
    }
  };
  add(locale);
  add(defaultLocale);
  chain.push(undefined);
  return chain;
};

const checkInput = (input) => {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('A template renderer renders { template, context, locale }.');
  }
  const template = checkTemplateName(input.template, 'template');
  const context = input.context ?? {};
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new TypeError('context must be an object.');
  }
  const { signal } = input;
  if (signal !== undefined && typeof signal?.addEventListener !== 'function') {
    throw new TypeError('signal must be an AbortSignal.');
  }
  return { template, context, locale: checkLocale(input.locale, 'locale'), signal };
};

const wrapError = (error, template, phase, engine) => {
  if (error instanceof TemplateRenderError) return inPhase(error, phase, engine?.name);
  // An engine may wrap what its include threw: a missing include stays one,
  // and a loader's failure stays the loader's, which may pass on another try.
  const found = templateErrorOf(error);
  if (found !== undefined) return inPhase(found, phase, engine?.name);
  return new TemplateRenderError(template, phase, messageOf(error), {
    cause: error,
    engine: engine?.name,
  });
};

// Calls an engine, with the bounds of the render while it runs, and makes
// what it throws an error of ./templates.
const run = async (phase, template, engine, step, bounds) => {
  try {
    return await withBounds(bounds, step);
  } catch (error) {
    throw wrapError(error, template, phase, engine);
  }
};

// A part of a message, held to maxOutputBytes of UTF-8, at most three bytes
// for each UTF-16 unit, so that most need no count.
const checkOutput = (config, phase, name, engine, value) => {
  const max = config.maxOutputBytes;
  if (value.length * 3 <= max || Buffer.byteLength(value) <= max) return value;
  throw new TemplateRenderError(
    name,
    phase,
    `The template gave more than ${max} bytes (maxOutputBytes).`,
    { engine: engine?.name },
  );
};

const normalizeSubject = (subject) => {
  if (subject === undefined) return undefined;
  const collapsed = decodeEntities(subject).replace(/\s+/g, ' ').trim();
  return collapsed === '' ? undefined : collapsed;
};

const isParts = (value) => typeof value === 'object' && value !== null;

// Milliseconds since `start`, to the microsecond.
const since = (start) => Math.round((performance.now() - start) * 1000) / 1000;

// A render, settled at its timeout or at the abort of its signal, whichever
// comes first: what it waits for goes on, for the renders that share it, and
// is not kept if it hangs.  The timer keeps the process, as its caller waits.
const inTime = (config, checked, rendering) => {
  const timeout = config.renderTimeoutMilliseconds;
  const { signal } = checked;
  if (!hasTimeout(timeout) && signal === undefined) return rendering;
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      settle();
      reject(abortReason(signal));
    };
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    if (hasTimeout(timeout)) {
      timer = setTimeout(() => {
        settle();
        reject(
          new TemplateRenderError(checked.template, 'timeout', `It took over ${timeout} ms.`, {
            requested: checked.template,
            locale: checked.locale,
          }),
        );
      }, timerMs(timeout));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    rendering.then(resolve, reject).finally(settle);
  });
};

/**
 * Makes a renderer of templates by name.
 *
 * @param options `engine` or `engines`, `loader`, `partials`, `layout`,
 * `globals`, `defaultLocale`, `variantName`, `frontMatter` (true),
 * `inlineCss`, `autoText` (true), `cache` (true, or `{ maxEntries }`),
 * `maxIncludes` (10000), `maxIncludeDepth` (32) and `maxOutputBytes`
 * (10 MiB).
 * @returns The renderer: `render({ template, context, locale })` and
 * `clear()`.
 * @throws {TypeError} If an option is invalid.
 */
const createTemplateRenderer = (options = {}) => {
  const config = createRendererConfig(options);
  const makeIncludes = (signal) =>
    createIncludes(config.loader, {
      partials: config.partials,
      cache: config.cache,
      maxEntries: config.maxEntries,
      maxIncludeDepth: config.maxIncludeDepth,
      timeoutMilliseconds: config.renderTimeoutMilliseconds,
      signal,
    });
  const compiled = createCache(config.cache ? config.maxEntries : 0);
  const resolved = createCache(config.cache ? config.maxEntries : 0);
  const state = { config, compiled, resolved, files: makeIncludes() };
  return {
    async render(input) {
      const checked = checkInput(input);
      checked.signal?.throwIfAborted();
      // Without a cache, each render reads and compiles anew, includes too,
      // which its signal stops.
      const current = config.cache ? state : { ...state, files: makeIncludes(checked.signal) };
      // The bounds of the render, and what it made itself rather than found
      // kept: a cache miss.
      const bounds = { includes: 0, maxIncludes: config.maxIncludes, missed: false };
      const start = performance.now();
      let output;
      try {
        output = await inTime(config, checked, renderTemplate(current, checked, input, bounds));
      } catch (error) {
        throw forRender(error, checked.template, checked.locale);
      }
      config.log.write(
        'debug',
        () => ({
          template: output.template,
          requested: checked.template,
          locale: checked.locale,
          engine: bounds.engine,
          cache: bounds.missed ? 'miss' : 'hit',
          durationMs: since(start),
        }),
        'templates.rendered',
      );
      return output;
    },
    clear() {
      // Engines key what they keep by the includes, so they make it anew too;
      // one that keeps it elsewhere, EJS in ejs.cache, forgets it.
      for (const engine of config.engines) engine.clear?.(state.files.includes);
      state.files = makeIncludes();
      compiled.clear();
      resolved.clear();
    },
  };
};

// The engines a name may be rendered by: the one its extension names, or
// each in turn with its extensions.
const choicesOf = (config, template) => {
  for (const { extension, engine } of config.suffixes) {
    if (template.endsWith(extension) && template.length > extension.length) {
      return {
        base: template.slice(0, -extension.length),
        choices: [{ engine, extensions: [extension] }],
      };
    }
  }
  const choices = [];
  for (const engine of config.engines) {
    choices.push({ engine, extensions: engine.extensions.length === 0 ? [''] : engine.extensions });
  }
  return { base: template, choices };
};

const findPart = async (state, base, locale, part, choices, tried) => {
  const stem = checkTemplateName(
    state.config.variantName(base, { locale, part }),
    'The name variantName gives',
  );
  for (const choice of choices) {
    for (const extension of choice.extensions) {
      const name = stem + extension;
      tried?.push(name);
      const source = await state.files.includes.read(name);
      if (source !== undefined) return { name, source, engine: choice.engine, choice };
    }
  }
  return undefined;
};

// The templates of a name at the first locale that has its HTML (or its text,
// for a template of text alone): the text and subject variants are taken at
// that locale only, so that a body in one language gets no subject in another.
const resolveTemplate = async (state, template, locale) => {
  const { base, choices } = choicesOf(state.config, template);
  const chain = localeChain(locale, state.config.defaultLocale);
  const tried = [];
  for (const main of ['html', 'text']) {
    for (const level of chain) {
      const found = await findPart(state, base, level, main, choices, tried);
      if (found === undefined) continue;
      const same = [found.choice];
      return {
        locale: level,
        html: main === 'html' ? found : undefined,
        text: main === 'html' ? await findPart(state, base, level, 'text', same) : found,
        subject: await findPart(state, base, level, 'subject', same),
      };
    }
  }
  throw new TemplateNotFoundError(template, tried, { phase: 'resolve' });
};

const resolvedFor = (state, template, locale, bounds) =>
  memoize(
    state.resolved,
    `${template}\u0000${locale ?? ''}`,
    () => {
      bounds.missed = true;
      return resolveTemplate(state, template, locale);
    },
    state.config.renderTimeoutMilliseconds,
  );

const compileEntry = async (state, found, part, bounds) => {
  const { name, engine } = found;
  let body = found.source.source;
  let fields;
  if (state.config.frontMatter && typeof body === 'string') {
    try {
      ({ body, fields } = parseFrontMatter(body));
    } catch (error) {
      throw new TemplateRenderError(name, 'front-matter', error.message, {
        cause: error,
        engine: engine.name,
      });
    }
  }
  const context = {
    name,
    path: found.source.path,
    part,
    cache: state.config.cache,
    includes: state.files.includes,
  };
  state.files.top(name);
  const start = performance.now();
  const render = await run('compile', name, engine, () => engine.compile(body, context), bounds);
  if (typeof render !== 'function') {
    throw new TemplateRenderError(name, 'compile', 'The engine gave no function.', {
      engine: engine.name,
    });
  }
  const subject =
    fields?.subject === undefined
      ? undefined
      : await run(
          'compile',
          name,
          engine,
          () => engine.compile(fields.subject, { ...context, part: 'subject' }),
          bounds,
        );
  state.config.log.write(
    'debug',
    () => ({ template: name, engine: engine.name, part, durationMs: since(start) }),
    'templates.compiled',
  );
  return { name, engine, render, subject, fields, context };
};

const compiledFor = (state, found, part, bounds) =>
  memoize(
    state.compiled,
    `${found.engine.name}\u0000${part}\u0000${found.name}`,
    () => {
      bounds.missed = true;
      return compileEntry(state, found, part, bounds);
    },
    state.config.renderTimeoutMilliseconds,
  );

const renderString = async (state, phase, entry, render, scope, bounds) => {
  const output = await run(phase, entry.name, entry.engine, () => render(scope), bounds);
  if (typeof output !== 'string') {
    throw new TemplateRenderError(entry.name, phase, 'The template gave no string.', {
      engine: entry.engine.name,
    });
  }
  return checkOutput(state.config, phase, entry.name, entry.engine, output);
};

const globalsOf = async (config, input) => {
  const { globals } = config;
  if (globals === undefined) return undefined;
  const values = typeof globals === 'function' ? await globals(input) : globals;
  if (values !== undefined && (typeof values !== 'object' || values === null)) {
    throw new TypeError('globals must give an object.');
  }
  return values;
};

const layoutNameOf = (config, entry) => {
  const asked = entry.fields?.layout;
  if (asked !== undefined && NO_LAYOUT.has(asked)) return undefined;
  const name = asked ?? config.layout;
  if (name === undefined) return undefined;
  return checkTemplateName(name, `The layout of ${entry.name}`);
};

// Renders the HTML of a template into its layout, when it has one.
const applyLayout = async (state, entry, html, scope, locale, bounds) => {
  const name = layoutNameOf(state.config, entry);
  if (name === undefined) return { html, engine: entry.engine, context: entry.context };
  let resolution;
  try {
    resolution = await resolvedFor(state, name, locale, bounds);
  } catch (error) {
    if (!(error instanceof TemplateNotFoundError)) throw inPhase(error, 'layout');
    throw new TemplateNotFoundError(name, error.tried, {
      from: entry.name,
      cause: error,
      phase: 'layout',
    });
  }
  if (resolution.html === undefined) {
    throw new TemplateRenderError(entry.name, 'layout', `The layout ${name} has no HTML.`, {
      engine: entry.engine.name,
    });
  }
  const layout = await compiledFor(state, resolution.html, 'html', bounds);
  if (layout.fields?.layout !== undefined) {
    throw new TemplateRenderError(layout.name, 'layout', 'A layout has no layout of its own.', {
      engine: layout.engine.name,
    });
  }
  const wrapped = await renderString(
    state,
    'layout',
    layout,
    layout.render,
    { ...scope, body: html },
    bounds,
  );
  return { html: wrapped, engine: layout.engine, context: layout.context };
};

const renderTemplate = async (state, checked, input, bounds) => {
  const { config } = state;
  let resolution;
  try {
    resolution = await resolvedFor(
      state,
      checked.template,
      allowedLocale(config, checked.locale),
      bounds,
    );
  } catch (error) {
    throw inPhase(error, 'resolve');
  }
  // An aborted render stops at its next step, as it rejected already.
  checked.signal?.throwIfAborted();
  const scope = { ...(await globalsOf(config, input)), ...checked.context };
  const main = await compiledFor(
    state,
    resolution.html ?? resolution.text,
    resolution.html ? 'html' : 'text',
    bounds,
  );
  bounds.engine = main.engine.name;
  let html;
  let text;
  let subject;
  checked.signal?.throwIfAborted();
  const output = await run('render', main.name, main.engine, () => main.render(scope), bounds);
  checked.signal?.throwIfAborted();
  if (typeof output === 'string') {
    if (resolution.html === undefined) text = decodeEntities(output);
    else html = output;
  } else if (isParts(output)) {
    if (layoutNameOf(config, main) !== undefined) {
      throw new TemplateRenderError(
        main.name,
        'layout',
        'It gave its parts, which no layout wraps.',
        {
          engine: main.engine.name,
        },
      );
    }
    ({ html, text, subject } = output);
  } else {
    throw new TemplateRenderError(main.name, 'render', 'The template gave no string.', {
      engine: main.engine.name,
    });
  }
  if (html !== undefined && typeof output === 'string') {
    checkOutput(config, 'render', main.name, main.engine, html);
    const outer = await applyLayout(state, main, html, scope, resolution.locale, bounds);
    html = outer.html;
    if (typeof outer.engine.finish === 'function') {
      const finish = () => outer.engine.finish(html, outer.context);
      html = await run('finish', main.name, outer.engine, finish, bounds);
      checkOutput(config, 'finish', main.name, outer.engine, html);
    }
  }
  if (html !== undefined && config.inlineCss !== undefined) {
    html = await run('inline-css', main.name, undefined, () => config.inlineCss(html), bounds);
    checkOutput(config, 'inline-css', main.name, undefined, html);
  }
  if (text === undefined && resolution.html !== undefined && resolution.text !== undefined) {
    const entry = await compiledFor(state, resolution.text, 'text', bounds);
    text = decodeEntities(await renderString(state, 'render', entry, entry.render, scope, bounds));
  }
  if (subject === undefined && main.subject !== undefined) {
    subject = await renderString(state, 'render', main, main.subject, scope, bounds);
  }
  if (subject === undefined && resolution.subject !== undefined) {
    const entry = await compiledFor(state, resolution.subject, 'subject', bounds);
    subject = await renderString(state, 'render', entry, entry.render, scope, bounds);
  }
  return outputOf(config, main, resolution, { html, text, subject });
};

const outputOf = (config, main, resolution, parts) => {
  const { html } = parts;
  for (const key of ['html', 'text', 'subject']) {
    if (parts[key] === undefined) continue;
    if (typeof parts[key] !== 'string') {
      throw new TemplateRenderError(
        main.name,
        'render',
        `The template gave its ${key} as no string.`,
        { engine: main.engine.name },
      );
    }
    checkOutput(config, 'render', main.name, main.engine, parts[key]);
  }
  const text = parts.text ?? (config.autoText && html !== undefined ? htmlToText(html) : undefined);
  if (html === undefined && text === undefined) {
    throw new TemplateRenderError(main.name, 'render', 'The template gave neither html nor text.', {
      engine: main.engine.name,
    });
  }
  const output = { template: main.name };
  if (html !== undefined) output.html = html;
  if (text !== undefined) output.text = text;
  const subject = normalizeSubject(parts.subject);
  if (subject !== undefined) output.subject = subject;
  if (resolution.locale !== undefined) output.locale = resolution.locale;
  return output;
};

module.exports = { createTemplateRenderer };
