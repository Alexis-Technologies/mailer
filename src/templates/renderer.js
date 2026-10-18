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
const { createCache, memoize } = require('./cache.js');
const { TemplateNotFoundError, TemplateRenderError, templateErrorOf } = require('./errors.js');
const { parseFrontMatter } = require('./front-matter.js');
const { createIncludes } = require('./includes.js');
const { checkTemplateName } = require('./loader.js');

const DEFAULT_MAX_ENTRIES = 1000;
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

const checkLocale = (locale, what) => {
  if (locale === undefined) return undefined;
  if (typeof locale !== 'string') throw new TypeError(`${what} must be a string.`);
  return Intl.getCanonicalLocales(locale)[0];
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
  if (options.layout !== undefined) checkTemplateName(options.layout, 'layout');
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
    variantName: checkOptionalFunction(options.variantName, 'variantName') ?? defaultVariantName,
    frontMatter: options.frontMatter ?? true,
    inlineCss: checkOptionalFunction(options.inlineCss, 'inlineCss'),
    autoText: options.autoText ?? true,
    cache: cache !== false,
    maxEntries,
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
  return { template, context, locale: checkLocale(input.locale, 'locale') };
};

const wrapError = (error, template, phase, engine) => {
  if (error instanceof TemplateRenderError) return error;
  // An engine may wrap what its include threw: a missing include stays one,
  // and a loader's failure stays the loader's, which may pass on another try.
  const found = templateErrorOf(error);
  if (found !== undefined) return found;
  return new TemplateRenderError(template, phase, messageOf(error), {
    cause: error,
    engine: engine?.name,
  });
};

const run = async (phase, template, engine, step) => {
  try {
    return await step();
  } catch (error) {
    throw wrapError(error, template, phase, engine);
  }
};

const normalizeSubject = (subject) => {
  if (subject === undefined) return undefined;
  const collapsed = decodeEntities(subject).replace(/\s+/g, ' ').trim();
  return collapsed === '' ? undefined : collapsed;
};

const isParts = (value) => typeof value === 'object' && value !== null;

/**
 * Makes a renderer of templates by name.
 *
 * @param options `engine` or `engines`, `loader`, `partials`, `layout`,
 * `globals`, `defaultLocale`, `variantName`, `frontMatter` (true),
 * `inlineCss`, `autoText` (true) and `cache` (true, or `{ maxEntries }`).
 * @returns The renderer: `render({ template, context, locale })` and
 * `clear()`.
 * @throws {TypeError} If an option is invalid.
 */
const createTemplateRenderer = (options = {}) => {
  const config = createRendererConfig(options);
  const makeIncludes = () =>
    createIncludes(config.loader, {
      partials: config.partials,
      cache: config.cache,
      maxEntries: config.maxEntries,
    });
  const compiled = createCache(config.cache ? config.maxEntries : 0);
  const resolved = createCache(config.cache ? config.maxEntries : 0);
  const state = { config, compiled, resolved, includes: makeIncludes() };
  return {
    async render(input) {
      const checked = checkInput(input);
      // Without a cache, each render reads and compiles anew, includes too.
      const current = config.cache ? state : { ...state, includes: makeIncludes() };
      return renderTemplate(current, checked, input);
    },
    clear() {
      // Engines key what they keep by the includes, so they make it anew too.
      state.includes = makeIncludes();
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
  const stem = state.config.variantName(base, { locale, part });
  if (typeof stem !== 'string') throw new TypeError('variantName must give a name.');
  for (const choice of choices) {
    for (const extension of choice.extensions) {
      const name = stem + extension;
      tried?.push(name);
      const source = await state.includes.read(name);
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
  throw new TemplateNotFoundError(template, tried);
};

const resolvedFor = (state, template, locale) =>
  memoize(state.resolved, `${template}\u0000${locale ?? ''}`, () =>
    resolveTemplate(state, template, locale),
  );

const compileEntry = async (state, found, part) => {
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
    includes: state.includes,
  };
  const render = await run('compile', name, engine, () => engine.compile(body, context));
  if (typeof render !== 'function') {
    throw new TemplateRenderError(name, 'compile', 'The engine gave no function.', {
      engine: engine.name,
    });
  }
  const subject =
    fields?.subject === undefined
      ? undefined
      : await run('compile', name, engine, () =>
          engine.compile(fields.subject, { ...context, part: 'subject' }),
        );
  return { name, engine, render, subject, fields, context };
};

const compiledFor = (state, found, part) =>
  memoize(state.compiled, `${found.engine.name}\u0000${part}\u0000${found.name}`, () =>
    compileEntry(state, found, part),
  );

const renderString = async (phase, entry, render, scope) => {
  const output = await run(phase, entry.name, entry.engine, () => render(scope));
  if (typeof output !== 'string') {
    throw new TemplateRenderError(entry.name, phase, 'The template gave no string.', {
      engine: entry.engine.name,
    });
  }
  return output;
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
const applyLayout = async (state, entry, html, scope, locale) => {
  const name = layoutNameOf(state.config, entry);
  if (name === undefined) return { html, engine: entry.engine, context: entry.context };
  let resolution;
  try {
    resolution = await resolvedFor(state, name, locale);
  } catch (error) {
    if (!(error instanceof TemplateNotFoundError)) throw error;
    throw new TemplateNotFoundError(name, error.tried, { from: entry.name, cause: error });
  }
  if (resolution.html === undefined) {
    throw new TemplateRenderError(entry.name, 'layout', `The layout ${name} has no HTML.`);
  }
  const layout = await compiledFor(state, resolution.html, 'html');
  if (layout.fields?.layout !== undefined) {
    throw new TemplateRenderError(layout.name, 'layout', 'A layout has no layout of its own.');
  }
  const wrapped = await renderString('layout', layout, layout.render, { ...scope, body: html });
  return { html: wrapped, engine: layout.engine, context: layout.context };
};

const renderTemplate = async (state, checked, input) => {
  const { config } = state;
  const resolution = await resolvedFor(state, checked.template, checked.locale);
  const scope = { ...(await globalsOf(config, input)), ...checked.context };
  const main = await compiledFor(
    state,
    resolution.html ?? resolution.text,
    resolution.html ? 'html' : 'text',
  );
  let html;
  let text;
  let subject;
  const output = await run('render', main.name, main.engine, () => main.render(scope));
  if (typeof output === 'string') {
    if (resolution.html === undefined) text = decodeEntities(output);
    else html = output;
  } else if (isParts(output)) {
    ({ html, text, subject } = output);
  } else {
    throw new TemplateRenderError(main.name, 'render', 'The template gave no string.', {
      engine: main.engine.name,
    });
  }
  if (html !== undefined && typeof output === 'string') {
    const outer = await applyLayout(state, main, html, scope, resolution.locale);
    html = outer.html;
    if (typeof outer.engine.finish === 'function') {
      html = await run('finish', main.name, outer.engine, () =>
        outer.engine.finish(html, outer.context),
      );
    }
  }
  if (html !== undefined && config.inlineCss !== undefined) {
    html = await run('inline-css', main.name, undefined, () => config.inlineCss(html));
  }
  if (text === undefined && resolution.html !== undefined && resolution.text !== undefined) {
    const entry = await compiledFor(state, resolution.text, 'text');
    text = decodeEntities(await renderString('render', entry, entry.render, scope));
  }
  if (subject === undefined && main.subject !== undefined) {
    subject = await renderString('render', main, main.subject, scope);
  }
  if (subject === undefined && resolution.subject !== undefined) {
    const entry = await compiledFor(state, resolution.subject, 'subject');
    subject = await renderString('render', entry, entry.render, scope);
  }
  return outputOf(config, main, resolution, { html, text, subject });
};

const outputOf = (config, main, resolution, parts) => {
  const { html } = parts;
  for (const key of ['html', 'text', 'subject']) {
    if (parts[key] !== undefined && typeof parts[key] !== 'string') {
      throw new TemplateRenderError(
        main.name,
        'render',
        `The template gave its ${key} as no string.`,
      );
    }
  }
  const text = parts.text ?? (config.autoText && html !== undefined ? htmlToText(html) : undefined);
  if (html === undefined && text === undefined) {
    throw new TemplateRenderError(main.name, 'render', 'The template gave neither html nor text.');
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
