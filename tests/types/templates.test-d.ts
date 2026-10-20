import { expectAssignable, expectError, expectType } from 'tsd';
import handlebars from 'handlebars';
import { Liquid } from 'liquidjs';
import { Eta } from 'eta';
import juice from 'juice';
import { inline } from '@css-inline/css-inline';
import { createMessage } from '../../index.js';
import { renderFields, type Renderer } from '../../src/render/index.js';
import {
  createCssInliner,
  createEjsEngine,
  createEtaEngine,
  createFileLoader,
  createHandlebarsEngine,
  createLiquidEngine,
  createMemoryLoader,
  createMjmlEngine,
  createMustacheEngine,
  createNunjucksEngine,
  createPugEngine,
  createReactEmailEngine,
  createTemplateRenderer,
  TemplateLoadError,
  TemplateNotFoundError,
  TemplateRenderError,
  type TemplateEngine,
  type TemplateInput,
  type TemplateInputOf,
  type TemplateOutput,
  type TemplateRenderer,
  type TemplateRenderPhase,
} from '../../src/templates/index.js';

// The engines of the real packages, as typed, fit the structural modules.
const hbs = createHandlebarsEngine({ handlebars, helpers: { upper: (s: string) => s } });
expectAssignable<TemplateEngine>(hbs);
expectAssignable<TemplateEngine>(
  createLiquidEngine({ Liquid, options: { strictVariables: true } }),
);
expectAssignable<TemplateEngine>(createEtaEngine({ Eta, async: true }));
const juiced = createCssInliner({ inline: juice });
const cssInline = createCssInliner({ inline, options: { keepStyleTags: true } });
expectType<Promise<string>>(juiced('<p>x</p>'));

declare const ejs: { compile(source: string, options?: object): (data?: object) => string };
declare const pug: { compile(source: string, options?: object): (locals?: object) => string };
declare const mustache: { Writer: new () => object; Context: new (view: object) => object };
declare const nunjucks: {
  Environment: new (loaders: unknown, options?: object) => object;
  Template: new (
    source: string,
    env: object,
    path?: string,
    eager?: boolean,
  ) => {
    render(context: object, callback: (error: Error | null, result?: string | null) => void): void;
  };
};
declare const mjml2html: (mjml: string, options?: object) => Promise<{ html: string }>;
createEjsEngine({ ejs, options: { async: false } });
createPugEngine({ pug });
createMustacheEngine({ mustache, tags: ['<%', '%>'] });
createNunjucksEngine({ nunjucks, filters: { upper: (s: string) => s.toUpperCase() } });
createMjmlEngine({ mjml2html, engine: hbs, includes: false, onErrors: (errors) => errors.length });
expectError(createEjsEngine({}));
createHandlebarsEngine({ handlebars, options: { noEscape: true }, allowUnescaped: true });
expectError(createEtaEngine({ Eta, allowUnescaped: 'yes' }));
expectError(createMustacheEngine({ mustache, tags: ['<%'] }));

declare const render: (element: { type: string }) => Promise<string>;
declare const createElement: (
  component: (props: any) => unknown,
  props: object,
) => {
  type: string;
};
const react = createReactEmailEngine({
  render,
  createElement,
  components: {
    welcome: { component: () => null, subject: (props: { name: string }) => props.name },
  },
});

const templates = createTemplateRenderer({
  engine: hbs,
  loader: createFileLoader({ dir: 'emails', extensions: ['.hbs'], maxBytes: 1024 }),
  partials: ['partials'],
  layout: 'layouts/main',
  globals: (input) => ({ locale: input.locale }),
  defaultLocale: 'en',
  locales: ['en', 'uk'],
  inlineCss: cssInline,
  cache: { maxEntries: 100 },
  maxIncludes: 100,
  maxIncludeDepth: 8,
  maxOutputBytes: Infinity,
});
expectAssignable<Renderer<TemplateInput>>(templates);
const output = await templates.render({
  template: 'welcome',
  context: { name: 'Ada' },
  locale: 'uk',
  tenantId: 'acme',
  signal: AbortSignal.timeout(1000),
});
expectError(templates.render({ template: 'welcome', signal: 'now' }));
createTemplateRenderer({
  engine: hbs,
  loader: {
    load: (name, options) => (options?.signal?.aborted ? undefined : { name, source: '' }),
  },
  renderTimeoutMilliseconds: 5000,
  logger: { debug: (properties: object, message: string) => [properties, message] },
});
expectType<TemplateOutput>(output);
expectType<string | undefined>(output.subject);
expectType<string>(output.template);
templates.clear();
const fields = await renderFields(templates, { template: 'welcome' });
createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: fields.subject ?? 'x',
  content: fields.content,
});
createTemplateRenderer({ engines: [hbs, react], loader: createMemoryLoader({ welcome: '<p/>' }) });
expectType<string | undefined>(createFileLoader({ dir: 'emails' }).loadSync('welcome.hbs')?.source);
expectType<boolean | undefined>(react.parts);
expectError(templates.render({ context: {} }));

// Typed templates: each name with its own context.
type Inputs = TemplateInputOf<{ welcome: { name: string }; reset: { url: string } }>;
const typed: TemplateRenderer<Inputs> = createTemplateRenderer<Inputs>({
  engine: hbs,
  loader: createMemoryLoader({}),
});
typed.render({ template: 'welcome', context: { name: 'Ada' } });
expectError(typed.render({ template: 'welcome', context: { url: 'x' } }));

const missing = new TemplateNotFoundError('welcome', ['welcome.hbs'], { from: 'layout' });
expectType<'MAILER_TEMPLATE_NOT_FOUND'>(missing.code);
expectType<false>(missing.retryable);
expectType<readonly string[]>(missing.tried);
const broken = new TemplateRenderError('welcome', 'compile', 'x', { engine: 'handlebars' });
expectType<'MAILER_TEMPLATE_RENDER'>(broken.code);
expectType<string | undefined>(broken.requested);
expectType<TemplateRenderPhase | undefined>(missing.phase);
expectType<string | undefined>(missing.locale);
const failed = new TemplateLoadError('welcome.hbs', { from: 'layout', cause: new Error('EMFILE') });
expectType<'MAILER_TEMPLATE_LOAD'>(failed.code);
expectType<true | undefined>(failed.retryable);
