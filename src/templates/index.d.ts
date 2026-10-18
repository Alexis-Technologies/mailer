// Not ported: the types of ./templates, templates by name rendered by an
// engine the application passes in.

import type { ReactEmailRenderOptions, RenderOutput, Renderer } from '../render/index.js';

/** The values a template renders. */
export type TemplateContext = Readonly<Record<string, unknown>>;

/** What a template renderer takes, as the worker of `./queue` gives it. */
export interface TemplateInput<TContext extends object = TemplateContext> {
  /**
   * A name, never a path: `welcome`, `auth/reset-password`. With the
   * extension of an engine (`welcome.hbs`), that engine alone.
   */
  readonly template: string;
  readonly context?: TContext;
  /**
   * A BCP 47 tag. `uk-UA` is looked up as `uk-UA`, `uk`, then the
   * `defaultLocale` so, then the template without a locale.
   */
  readonly locale?: string;
  /** The tenant the message is for, as the worker of `./queue` gives it: for `globals`, which the renderer reads nothing of. */
  readonly tenantId?: string;
  /**
   * Stops the render, which rejects with its reason. With the cache on, a
   * read or a compile that other renders wait for goes on for them; without
   * it, the reads of the render are its own, and the loader is given the
   * signal.
   */
  readonly signal?: AbortSignal;
}

/**
 * The inputs of typed templates: `TemplateInputOf<{ welcome: { name: string } }>`.
 */
export type TemplateInputOf<TTemplates extends { readonly [name: string]: object }> = {
  readonly [K in keyof TTemplates & string]: TemplateInput<TTemplates[K]> & {
    readonly template: K;
  };
}[keyof TTemplates & string];

/** What a template renderer gives. */
export interface TemplateOutput extends RenderOutput {
  /** The name of the template the message came from, as its loader has it: `welcome.uk.hbs`. */
  readonly template: string;
  /** The locale of that template; undefined for the one without. */
  readonly locale?: string;
}

/** A template as a loader gives it. */
export interface TemplateSource<TSource = string> {
  readonly name: string;
  readonly source: TSource;
  /** Its real path, for a template on disk: for the messages of an engine, and MJML's mj-include. */
  readonly path?: string;
}

/** What a loader is told as it reads. */
export interface TemplateLoadOptions {
  /**
   * Aborted when the read is no longer waited for: at the timeout of the
   * render (`TimeoutError`), or, without a cache, at the abort of the one
   * render it is for. A loader that can stop, a query or a fetch, stops.
   */
  readonly signal?: AbortSignal;
}

/**
 * Where templates are read by name: relative to the root of the loader, `/`
 * between directories, no segment starting with `.`.
 */
export interface TemplateLoader<TSource = string> {
  /** The template of that name, or undefined when there is none. */
  load(
    name: string,
    options?: TemplateLoadOptions,
  ): TemplateSource<TSource> | undefined | Promise<TemplateSource<TSource> | undefined>;
  /**
   * The same, synchronously: EJS, Pug, Eta and Mustache read their includes
   * so, and need it.
   */
  loadSync?(name: string): TemplateSource<TSource> | undefined;
}

/** The options of {@link createFileLoader}. */
export interface FileLoaderOptions {
  /** The directory of the templates. Nothing outside it is read, through `..` or a symbolic link. */
  readonly dir: string;
  /** The extensions it reads, with their dot; any by default. */
  readonly extensions?: readonly string[];
  /** The largest template it reads, in bytes. @default 1048576 */
  readonly maxBytes?: number;
}

/**
 * Makes a loader of the templates in a directory.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createFileLoader(options: FileLoaderOptions): TemplateLoader<string>;

/**
 * Makes a loader of templates held in memory, by name.
 *
 * @throws {TypeError} If a key is not a template name.
 */
export declare function createMemoryLoader<TSource = string>(
  templates: Readonly<Record<string, TSource>>,
): TemplateLoader<TSource>;

/** What an engine compiles: the HTML of a message, its text, or its subject. */
export type TemplatePart = 'html' | 'text' | 'subject';

/**
 * How an engine reads the includes, partials and layouts of a template:
 * through the loader of its renderer, checked and kept as its templates are.
 * One object per renderer (a new one after `clear()`, and for each render
 * without a cache), so an engine keys what it keeps by it, in a WeakMap.
 */
export interface TemplateIncludes<TSource = string> {
  /** The directories searched by a bare name after the root. */
  readonly partials: readonly string[];
  /** Whether what is read and compiled may be kept. */
  readonly cache: boolean;
  /**
   * The name `include` stands for in the template `from`: `./x` and `../x`
   * against its directory, `/x` from the root, any other as it is; undefined
   * when it leads out of the root.
   */
  join(from: string | undefined, include: string): string | undefined;
  read(name: string): Promise<TemplateSource<TSource> | undefined>;
  /** @throws {TypeError} If the loader has no loadSync. */
  readSync(name: string): TemplateSource<TSource> | undefined;
  /**
   * The template an include names: as joined, then under each directory of
   * partials for a bare name, each with the extensions given unless it has
   * one, then as it is.
   *
   * @throws {TemplateNotFoundError} If there is none.
   */
  lookup(
    include: string,
    from?: string,
    extensions?: readonly string[],
  ): Promise<TemplateSource<TSource>>;
  /** The same, synchronously. */
  lookupSync(
    include: string,
    from?: string,
    extensions?: readonly string[],
  ): TemplateSource<TSource>;
}

/** What an engine is told of the template it compiles. */
export interface TemplateCompileContext<TSource = string> {
  /** The loader's name of the template. */
  readonly name: string;
  readonly path?: string;
  readonly part: TemplatePart;
  /** Whether compiled includes may be kept: false under `cache: false`. */
  readonly cache: boolean;
  readonly includes: TemplateIncludes<TSource>;
}

/**
 * A compiled template: the text it renders, or the parts of an engine that
 * renders them at once (React Email: its HTML, text and subject).
 */
export type CompiledTemplate = (
  context: TemplateContext,
) => string | RenderOutput | Promise<string | RenderOutput>;

/** An engine of templates, made by one of the `create…Engine` functions or of your own. */
export interface TemplateEngine<TSource = string> {
  /** Its name, in errors: `handlebars`. */
  readonly name: string;
  /**
   * The extensions of its templates with their dot, the default first:
   * `['.hbs', '.handlebars']`. None: names are taken as they are.
   */
  readonly extensions: readonly string[];
  /** Compiles a template once; the renderer keeps what it gives. */
  compile(
    source: TSource,
    context: TemplateCompileContext<TSource>,
  ): CompiledTemplate | Promise<CompiledTemplate>;
  /**
   * Makes the HTML of the outermost template, its layout applied, the HTML of
   * the message, once per render: MJML's.
   */
  finish?(html: string, context: TemplateCompileContext<TSource>): string | Promise<string>;
  /** The templates of an engine whose templates are code (React Email), when the renderer has no loader. */
  readonly loader?: TemplateLoader<TSource>;
}

/** Inlines the CSS of an HTML body. */
export type CssInliner = (html: string) => Promise<string>;

/** The options of {@link createCssInliner}. */
export interface CssInlinerOptions {
  /** `require('juice').default`, or `require('@css-inline/css-inline').inline`. */
  readonly inline: (html: string, options?: any) => string | Promise<string>;
  /**
   * Its options, over `{ loadRemoteStylesheets: false, keepLinkTags: true }`:
   * css-inline's switches, so that it fetches nothing and keeps a font's
   * <link>; juice, which fetches nothing itself, ignores them.
   */
  readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * Makes the CSS inliner of a template renderer.
 *
 * @throws {TypeError} If `inline` is not a function.
 */
export declare function createCssInliner(options: CssInlinerOptions): CssInliner;

/** The options of the cache of a template renderer. */
export interface TemplateCacheOptions {
  /** The most compiled templates, resolved names and sources kept, the least recently used dropped first. @default 1000 */
  readonly maxEntries?: number;
}

/** The options of {@link createTemplateRenderer}. */
export interface TemplateRendererOptions<TSource = string> {
  /** The engine of every template; or `engines`, by extension, the longest first. */
  readonly engine?: TemplateEngine<TSource>;
  readonly engines?: readonly TemplateEngine<TSource>[];
  /** Where templates are read; that of the engine when it has one. */
  readonly loader?: TemplateLoader<TSource>;
  /** Directories searched by a bare name after the root: `['partials']`. */
  readonly partials?: readonly string[];
  /**
   * The layout of every HTML template, rendered with its context and `body`,
   * the HTML of the template; front matter `layout: none` opts out, and
   * `layout: <name>` names another.
   */
  readonly layout?: string;
  /** Values in every context, under the input's; a function of the input renders them per message. */
  readonly globals?:
    | TemplateContext
    | ((
        input: TemplateInput,
      ) => TemplateContext | undefined | Promise<TemplateContext | undefined>);
  /** The locale tried after the requested ones, before the templates without one. */
  readonly defaultLocale?: string;
  /** The name of a variant before its extension. @default `${template}[.${locale}][.text|.subject]` */
  readonly variantName?: (
    template: string,
    variant: { readonly locale?: string; readonly part: TemplatePart },
  ) => string;
  /** Reads `subject` and `layout` from front matter. @default true */
  readonly frontMatter?: boolean;
  /** Inlines the CSS of the HTML, after MJML and before the text. None by default. */
  readonly inlineCss?: CssInliner;
  /** The text from the HTML with htmlToText when there is no text template. @default true */
  readonly autoText?: boolean;
  /** false reads and compiles every template on each render, for development. @default true */
  readonly cache?: boolean | TemplateCacheOptions;
  /**
   * The includes, partials and layouts an engine looks up in one render, as
   * it runs synchronously (what it looks up after an await of its own is not
   * counted); more fail the render. Infinity for no bound. @default 10000
   */
  readonly maxIncludes?: number;
  /**
   * How deep a chain of includes goes, each written in the one before, as the
   * engine names the template an include is written in. Infinity for no
   * bound. @default 32
   */
  readonly maxIncludeDepth?: number;
  /** The largest HTML, text or subject a render gives, in bytes of UTF-8. Infinity for no bound. @default 10485760 */
  readonly maxOutputBytes?: number;
  /**
   * How long a render may take: then it fails with a retryable
   * `TemplateRenderError` of phase `timeout`, and a read or a compile it
   * waited for is made anew by the next render rather than kept. 0 or
   * Infinity for none. A template that loops without awaiting cannot be
   * stopped so: Liquid's `renderLimit` stops one. @default 30000
   */
  readonly renderTimeoutMilliseconds?: number;
}

/** A renderer of templates by name, a `Renderer` of `./render`. */
export interface TemplateRenderer<
  TInput extends TemplateInput<any> = TemplateInput,
> extends Renderer<TInput> {
  /**
   * @throws {TemplateNotFoundError} If there is no such template.
   * @throws {TemplateRenderError} If it does not render.
   * @throws {TemplateLoadError} If the loader failed to read one.
   * @throws {TypeError} If the input is invalid.
   */
  render(input: TInput): Promise<TemplateOutput>;
  /** Forgets compiled templates and includes; the next render reads them again. */
  clear(): void;
}

/**
 * Makes a renderer of templates by name.
 *
 * @example
 * ```js
 * const ejs = require('ejs');
 * const templates = createTemplateRenderer({
 *   engine: createEjsEngine({ ejs }),
 *   loader: createFileLoader({ dir: path.join(__dirname, 'emails') }),
 *   layout: 'layouts/letter',
 * });
 * const { subject, content } = await renderFields(templates, {
 *   template: 'reset-password', context: { url }, locale: 'uk',
 * });
 * ```
 * @throws {TypeError} If an option is invalid.
 */
export declare function createTemplateRenderer<
  TInput extends TemplateInput<any> = TemplateInput,
  TSource = string,
>(options: TemplateRendererOptions<TSource>): TemplateRenderer<TInput>;

/** Where a render failed: looking up its template, or one of its steps. */
export type TemplateRenderPhase =
  | 'resolve'
  | 'front-matter'
  | 'compile'
  | 'render'
  | 'layout'
  | 'finish'
  | 'inline-css'
  | 'timeout';

/**
 * What an error of ./templates tells of a render, for a worker to read
 * without its message. A render sets `requested` and `locale`; the step and
 * the engine are set where they are known.
 */
export interface TemplateErrorFields {
  /** The step of the render that failed. */
  readonly phase?: TemplateRenderPhase;
  /** The name of the engine of the template that failed. */
  readonly engine?: string;
  /** The template the render was asked for: `welcome`, where `template` may be `welcome.uk.hbs` or a partial. */
  readonly requested?: string;
  /** The locale the render was asked for, canonical (`uk-UA`); none when it was asked for none. */
  readonly locale?: string;
}

/** The options of the errors of ./templates. */
export interface TemplateErrorOptions extends ErrorOptions, TemplateErrorFields {}

/** The options of {@link TemplateNotFoundError}. */
export interface TemplateNotFoundErrorOptions extends TemplateErrorOptions {
  /** The template that included it, for an include, a partial or a layout. */
  readonly from?: string;
}

/** No template, include, partial or layout by that name. Not retryable. */
export declare class TemplateNotFoundError extends Error implements TemplateErrorFields {
  readonly code: 'MAILER_TEMPLATE_NOT_FOUND';
  readonly retryable: false;
  /** The name looked up: the template asked for, or an include, partial or layout of it. */
  readonly template: string;
  readonly from?: string;
  /** The names looked up, in order. */
  readonly tried: readonly string[];
  readonly phase?: TemplateRenderPhase;
  readonly engine?: string;
  readonly requested?: string;
  readonly locale?: string;
  constructor(template: string, tried: readonly string[], options?: TemplateNotFoundErrorOptions);
}

/** The options of {@link TemplateLoadError}. */
export interface TemplateLoadErrorOptions extends TemplateErrorOptions {
  /** The template that included it, for an include, a partial or a layout. */
  readonly from?: string;
}

/**
 * A loader that failed to read a template: a file system that refused it, a
 * database that timed out. The loader's error is its `cause`. Retryable, as
 * it may pass on another attempt, unless the loader's error is a bug
 * (`TypeError`, `RangeError`…) or says `retryable: false`: then `retryable`
 * is unset, for a queue to classify by the cause.
 */
export declare class TemplateLoadError extends Error implements TemplateErrorFields {
  readonly code: 'MAILER_TEMPLATE_LOAD';
  readonly retryable?: true;
  /** The name the loader was asked for. */
  readonly template: string;
  readonly from?: string;
  readonly phase?: TemplateRenderPhase;
  readonly engine?: string;
  readonly requested?: string;
  readonly locale?: string;
  constructor(template: string, options?: TemplateLoadErrorOptions);
}

/** The options of {@link TemplateRenderError}. */
export interface TemplateRenderErrorOptions extends ErrorOptions {
  readonly engine?: string;
  readonly requested?: string;
  readonly locale?: string;
}

/**
 * A template that does not render: its syntax, a value it cannot read, a
 * helper that threw, MJML that does not validate. The engine's error is its
 * cause. Not retryable, as the same input fails again, but for phase
 * `timeout`: what the render waited for, a loader or a helper, may answer on
 * another attempt.
 */
export declare class TemplateRenderError extends Error implements TemplateErrorFields {
  readonly code: 'MAILER_TEMPLATE_RENDER';
  /** false; true for phase `timeout`. */
  readonly retryable: boolean;
  /** The template that failed, as its loader names it: `welcome.uk.hbs`, a layout, a partial. */
  readonly template: string;
  readonly phase: TemplateRenderPhase;
  readonly engine?: string;
  readonly requested?: string;
  readonly locale?: string;
  constructor(
    template: string,
    phase: TemplateRenderPhase,
    message: string,
    options?: TemplateRenderErrorOptions,
  );
}

// ---- Engines: each module typed by the members the adapter calls ----

/** The members of `require('ejs')` the engine calls. */
export interface EjsModule {
  compile(template: string, options?: object): (data?: object) => string | Promise<string>;
}
/** The options of {@link createEjsEngine}. */
export interface EjsEngineOptions {
  /** `require('ejs')`. */
  readonly ejs: EjsModule;
  /**
   * Of ejs.compile: `async`, `strict`, `rmWhitespace`, the delimiters,
   * `escape`. `filename`, `root`, `views`, `includer`, `cache` and `client`
   * are the engine's, and throw.
   */
  readonly options?: Readonly<Record<string, unknown>>;
  /**
   * Lets `escape` and `escapeFunction`, which replace it, turn off the escaping of output. Without it, they throw: the
   * values of a context, which a user may have written, would go into the
   * HTML raw. @default false
   */
  readonly allowUnescaped?: boolean;
  /** @default ['.ejs'] */
  readonly extensions?: readonly string[];
}
/**
 * The EJS engine. An include is read through the loader: `/x` from its root,
 * `./x` against the template rendered, any other from the root, then the
 * directories of partials.
 */
export declare function createEjsEngine(options: EjsEngineOptions): TemplateEngine;

/** The environment `handlebars.create()` gives. */
export interface HandlebarsEnvironment {
  parse(source: string): object;
  compile(program: object, options?: object): (context: unknown, options?: object) => string;
  registerPartial(name: string, partial: (context: unknown, options?: object) => string): void;
  registerHelper(name: string, helper: (...args: any[]) => unknown): void;
}
/** The members of `require('handlebars')` the engine calls. */
export interface HandlebarsModule {
  /** An environment of its own, so that helpers and partials stay out of the global one. */
  create(): HandlebarsEnvironment;
}
/** The options of {@link createHandlebarsEngine}. */
export interface HandlebarsEngineOptions {
  /** `require('handlebars')`. */
  readonly handlebars: HandlebarsModule;
  readonly helpers?: Readonly<Record<string, (...args: any[]) => unknown>>;
  /** Of compile: `strict`, `knownHelpers`, `knownHelpersOnly`, `preventIndent`, `noEscape`. */
  readonly options?: Readonly<Record<string, unknown>>;
  /**
   * Lets `noEscape: true` turn off the escaping of output. Without it, they throw: the
   * values of a context, which a user may have written, would go into the
   * HTML raw. @default false
   */
  readonly allowUnescaped?: boolean;
  /** Called with each environment the engine makes: decorators, more helpers. */
  readonly configure?: (environment: any) => void;
  /** @default ['.hbs', '.handlebars'] */
  readonly extensions?: readonly string[];
}
/**
 * The Handlebars engine. The partials a template names (`{{> footer}}`,
 * `{{#> layouts/main}}`) are read through the loader when it is compiled:
 * from the root, then the directories of partials. A dynamic partial,
 * `{{> (name)}}`, must be registered in `configure`.
 */
export declare function createHandlebarsEngine(options: HandlebarsEngineOptions): TemplateEngine;

/** The members of `require('pug')` the engine calls. */
export interface PugModule {
  compile(source: string, options?: object): (locals?: object) => string;
}
/** The options of {@link createPugEngine}. */
export interface PugEngineOptions {
  /** `require('pug')`. */
  readonly pug: PugModule;
  /**
   * Of pug.compile: `pretty`, `doctype`, `filters`, `globals`, `compileDebug`,
   * `plugins` (without resolve or read). `filename`, `basedir` and `cache`
   * are the engine's, and throw.
   */
  readonly options?: Readonly<Record<string, unknown>>;
  /** @default ['.pug'] */
  readonly extensions?: readonly string[];
}
/** The Pug engine: `include` and `extends` through the loader, `/x` from its root, any other against the file. */
export declare function createPugEngine(options: PugEngineOptions): TemplateEngine;

/** What MJML finds wrong in a template. */
export interface MjmlError {
  readonly line?: number;
  readonly message: string;
  readonly tagName?: string;
  readonly formattedMessage?: string;
}
/** What `mjml2html` gives. */
export interface MjmlResult {
  readonly html: string;
  readonly errors?: readonly MjmlError[];
}
/** The options of {@link createMjmlEngine}. */
export interface MjmlEngineOptions {
  /** `require('mjml')`: a promise in MJML 5, synchronous in MJML 4. */
  readonly mjml2html: (mjml: string, options?: object) => MjmlResult | Promise<MjmlResult>;
  /** The engine of the template, which MJML renders after, its layout applied; none for a static `.mjml`. */
  readonly engine?: TemplateEngine;
  /**
   * `validationLevel` ('soft'), `keepComments`, `fonts`, `juiceOptions`,
   * `minify`. `filePath`, `ignoreIncludes`, `includePath`, `mjmlConfigPath`,
   * `useMjmlConfigOptions` and `skeleton` are the engine's, and throw.
   */
  readonly options?: Readonly<Record<string, unknown>>;
  /** Lets mj-include read the files next to a template on disk, which MJML reads itself, unchecked. @default false */
  readonly includes?: boolean;
  /** Hears what MJML finds under 'soft'; by default a process warning (MAILER_TEMPLATE_MJML). */
  readonly onErrors?: (errors: readonly MjmlError[], template: string) => void;
  /** @default ['.mjml'], or '.mjml' before each extension of `engine` (['.mjml.hbs', '.mjml.handlebars']) */
  readonly extensions?: readonly string[];
}
/**
 * The MJML engine. A template of another engine is rendered by it, then by
 * MJML once its layout is applied, so its layout is MJML too.
 */
export declare function createMjmlEngine(options: MjmlEngineOptions): TemplateEngine;

/** The members of a liquidjs `Liquid` the engine calls. */
export interface LiquidInstance {
  parse(source: string, filepath?: string): any;
  render(template: any, scope?: object): Promise<unknown>;
  registerFilter(name: string, filter: (...args: any[]) => unknown): void;
}
/** The options of {@link createLiquidEngine}. */
export interface LiquidEngineOptions {
  /** `require('liquidjs').Liquid`. */
  readonly Liquid: new (options?: any) => LiquidInstance;
  /**
   * `outputEscape` ('escape', where liquidjs escapes nothing),
   * `ownPropertyOnly` (true), `strictFilters`, `strictVariables`, `jsTruthy`,
   * and the limits, where liquidjs has none: `parseLimit` (1048576, the
   * characters of a template), `renderLimit` (1000, the milliseconds of a
   * render) and `memoryLimit` (1e8). `root`, `partials`, `layouts`, `fs`,
   * `extname`, `relativeReference`, `templates` and `cache` are the engine's,
   * and throw.
   */
  readonly options?: Readonly<Record<string, unknown>>;
  readonly filters?: Readonly<Record<string, (...args: any[]) => unknown>>;
  readonly configure?: (liquid: any) => void;
  /**
   * Lets an `outputEscape` other than `'escape'` turn off the escaping of output. Without it, they throw: the
   * values of a context, which a user may have written, would go into the
   * HTML raw. @default false
   */
  readonly allowUnescaped?: boolean;
  /** @default ['.liquid'] */
  readonly extensions?: readonly string[];
}
/**
 * The Liquid engine: `include`, `render` and `layout` through the loader, from
 * the root, then the directories of partials, `./x` against the file. With
 * its limits, on by default, the engine of these for templates a tenant
 * writes; see the trust matrix of the guide.
 */
export declare function createLiquidEngine(options: LiquidEngineOptions): TemplateEngine;

/** The members of `require('nunjucks')` the engine calls. */
export interface NunjucksModule {
  readonly Environment: new (loaders: any, options?: object) => any;
  readonly Template: new (
    source: string,
    environment: any,
    path?: string,
    eagerCompile?: boolean,
  ) => {
    render(context: object, callback: (error: Error | null, result?: string | null) => void): void;
  };
}
/** The options of {@link createNunjucksEngine}. */
export interface NunjucksEngineOptions {
  /** `require('nunjucks')`. */
  readonly nunjucks: NunjucksModule;
  /** `autoescape` (true), `throwOnUndefined`, `trimBlocks`, `lstripBlocks`, `tags`. */
  readonly options?: Readonly<Record<string, unknown>>;
  /**
   * Lets a falsy `autoescape` turn off the escaping of output. Without it, they throw: the
   * values of a context, which a user may have written, would go into the
   * HTML raw. @default false
   */
  readonly allowUnescaped?: boolean;
  readonly filters?: Readonly<Record<string, (...args: any[]) => unknown>>;
  readonly configure?: (environment: any) => void;
  /** @default ['.njk', '.nunjucks'] */
  readonly extensions?: readonly string[];
}
/** The Nunjucks engine: `extends`, `include` and `import` through the loader, `./x` against the file. */
export declare function createNunjucksEngine(options: NunjucksEngineOptions): TemplateEngine;

/** The options of {@link createEtaEngine}. */
export interface EtaEngineOptions {
  /** `require('eta').Eta`. */
  readonly Eta: new (config?: any) => any;
  /**
   * `autoEscape` (true), `autoTrim`, `tags`, `varName`, `useWith`,
   * `functionHeader`, `plugins`. `views`, `cache`, `cacheFilepaths` and
   * `defaultExtension` are the engine's, and throw.
   */
  readonly options?: Readonly<Record<string, unknown>>;
  /**
   * Lets `autoEscape: false` and an `escapeFunction` of your own turn off the escaping of output. Without it, they throw: the
   * values of a context, which a user may have written, would go into the
   * HTML raw. @default false
   */
  readonly allowUnescaped?: boolean;
  /** Compiles to async functions, for `await` and `includeAsync`. @default false */
  readonly async?: boolean;
  /** @default ['.eta'] */
  readonly extensions?: readonly string[];
}
/** The Eta engine: `include()` and `layout()` through the loader, `./x` against the file. */
export declare function createEtaEngine(options: EtaEngineOptions): TemplateEngine;

/** The members of `require('mustache')` the engine calls. */
export interface MustacheModule {
  /** A writer of its own, whose cache the engine bounds; mustache.render shares one for the process. */
  readonly Writer: new () => any;
}
/** The options of {@link createMustacheEngine}. */
export interface MustacheEngineOptions {
  /** `require('mustache')`. */
  readonly mustache: MustacheModule;
  readonly tags?: readonly [string, string];
  /** @default ['.mustache'] */
  readonly extensions?: readonly string[];
}
/** The Mustache engine: partials through the loader, from the root; a missing one fails the render. */
export declare function createMustacheEngine(options: MustacheEngineOptions): TemplateEngine;

/** A React Email template: its component, and its subject. */
export interface ReactEmailTemplate<TProps = any> {
  readonly component: (props: TProps) => unknown;
  readonly subject?: string | ((props: TProps) => string);
}
/** The options of {@link createReactEmailEngine}. */
export interface ReactEmailEngineOptions<TElement = unknown> {
  /** `require('@react-email/render').render`. */
  readonly render: (
    element: TElement,
    options?: ReactEmailRenderOptions,
  ) => string | Promise<string>;
  /** `React.createElement`. */
  readonly createElement: (component: (props: any) => unknown, props: object) => TElement;
  /** The components by template name; `welcome.uk` for a locale. */
  readonly components: Readonly<Record<string, ((props: any) => unknown) | ReactEmailTemplate>>;
  /** The text from React Email's plain-text pass. @default true */
  readonly plainText?: boolean;
  readonly renderOptions?: ReactEmailRenderOptions;
}
/** React Email as an engine: its templates are its components, its loader theirs. */
export declare function createReactEmailEngine<TElement = unknown>(
  options: ReactEmailEngineOptions<TElement>,
): TemplateEngine<any>;
