// Not ported: tests of the engines of ./templates on the real engines, which
// are devDependencies, with the cases where @nestjs-modules/mailer went wrong.
const { test } = require('node:test');
const assert = require('node:assert');
const ejs = require('ejs');
const handlebars = require('handlebars');
const pug = require('pug');
const mjml2html = require('mjml');
const { Liquid } = require('liquidjs');
const nunjucks = require('nunjucks');
const { Eta } = require('eta');
const mustache = require('mustache');
const juice = require('juice').default;
const { inline } = require('@css-inline/css-inline');
const React = require('react');
const { render } = require('@react-email/render');
const {
  createCssInliner,
  createEjsEngine,
  createEtaEngine,
  createHandlebarsEngine,
  createLiquidEngine,
  createMemoryLoader,
  createMjmlEngine,
  createMustacheEngine,
  createNunjucksEngine,
  createPugEngine,
  createReactEmailEngine,
  createTemplateRenderer,
  TemplateNotFoundError,
  TemplateRenderError,
} = require('../../src/templates/index.js');

// A loader that counts its reads.
const countingLoader = (templates) => {
  const loader = createMemoryLoader(templates);
  const reads = [];
  return {
    reads,
    load: (name) => {
      reads.push(name);
      return loader.load(name);
    },
    loadSync: (name) => {
      reads.push(name);
      return loader.loadSync(name);
    },
  };
};

const renderWith = (engine, templates, input, options = {}) =>
  createTemplateRenderer({ engine, loader: createMemoryLoader(templates), ...options }).render(
    input,
  );

const failureOf = (promise) =>
  promise.then(
    () => assert.fail('expected a failure'),
    (error) => error,
  );

test('Templates: EJS escapes, includes through the loader and keeps raw output raw', async () => {
  const engine = createEjsEngine({ ejs });
  const templates = {
    'emails/welcome.ejs':
      '<p><%= name %></p><%- include("footer") %><%- include("./sign", { who: "me" }) %><%- raw %>',
    'partials/footer.ejs': '<footer><%= name %></footer>',
    'emails/sign.ejs': '<i><%= who %></i>',
  };
  const output = await renderWith(
    engine,
    templates,
    { template: 'emails/welcome', context: { name: '<Ada>', raw: '<b>bold</b>' } },
    { partials: ['partials'] },
  );
  assert.strictEqual(
    output.html,
    '<p>&lt;Ada&gt;</p><footer>&lt;Ada&gt;</footer><i>me</i><b>bold</b>',
  );
  const missing = await failureOf(
    renderWith(engine, { 'a.ejs': '<%- include("nope") %>' }, { template: 'a' }),
  );
  assert.ok(missing instanceof TemplateNotFoundError);
  assert.strictEqual(missing.from, 'a.ejs');
  const syntax = await failureOf(renderWith(engine, { 'a.ejs': '<% if ( %>' }, { template: 'a' }));
  assert.ok(syntax instanceof TemplateRenderError);
  assert.strictEqual(syntax.phase, 'compile');
  assert.strictEqual(syntax.engine, 'ejs');
});

test('Templates: an async EJS template that throws rejects, rather than hanging the send', async () => {
  // Before, in @nestjs-modules/mailer: `rendered.then(render)` had no catch.
  const engine = createEjsEngine({ ejs, options: { async: true } });
  const output = await renderWith(
    engine,
    { 'a.ejs': '<p><%= await Promise.resolve(name) %></p>' },
    { template: 'a', context: { name: 'x' } },
  );
  assert.strictEqual(output.html, '<p>x</p>');
  const error = await failureOf(
    renderWith(
      engine,
      { 'a.ejs': '<% await fail() %>' },
      {
        template: 'a',
        context: {
          fail: async () => {
            throw new Error('async boom');
          },
        },
      },
    ),
  );
  assert.ok(error instanceof TemplateRenderError);
  assert.match(error.message, /async boom/);
  assert.strictEqual(error.phase, 'render');
});

test('Templates: the EJS engine refuses what it sets itself', () => {
  assert.throws(() => createEjsEngine({}), /needs ejs/);
  for (const name of ['filename', 'root', 'views', 'includer', 'cache', 'client']) {
    assert.throws(() => createEjsEngine({ ejs, options: { [name]: 1 } }), new RegExp(name));
  }
  assert.throws(() => createEjsEngine({ ejs, options: 1 }), /must be an object/);
  assert.throws(() => createEjsEngine({ ejs, extensions: [] }), /a list/);
  assert.throws(() => createEjsEngine({ ejs, extensions: ['ejs'] }), /starts with its dot/);
  assert.deepStrictEqual(createEjsEngine({ ejs, extensions: ['.html'] }).extensions, ['.html']);
});

test('Templates: Handlebars keeps its helpers and partials out of the global environment', async () => {
  // Before: helpers and partials were registered on the global handlebars,
  // so one application's leaked into another's.
  const loader = countingLoader({
    'welcome.hbs': '{{#> layouts/main}}{{upper name}}{{> footer}}{{/layouts/main}}',
    'layouts/main.hbs': '<html>{{> @partial-block}}</html>',
    'partials/footer.hbs': '<footer>{{> copyright}}</footer>',
    'partials/copyright.hbs': '©',
    'other.hbs': '{{#*inline "local"}}inline{{/inline}}{{> local}}{{> footer}}',
  });
  const configured = [];
  const engine = createHandlebarsEngine({
    handlebars,
    helpers: { upper: (value) => String(value).toUpperCase() },
    configure: (env) => configured.push(env),
  });
  const renderer = createTemplateRenderer({ engine, loader, partials: ['partials'] });
  assert.strictEqual(
    (await renderer.render({ template: 'welcome', context: { name: 'ada' } })).html,
    '<html>ADA<footer>©</footer></html>',
  );
  assert.strictEqual(handlebars.helpers.upper, undefined);
  assert.strictEqual(handlebars.partials.footer, undefined);
  assert.strictEqual(configured.length, 1);
  assert.notStrictEqual(configured[0], handlebars);
  // Partials are read once, not again on each send.
  const reads = loader.reads.length;
  await renderer.render({ template: 'welcome', context: { name: 'b' } });
  assert.strictEqual(loader.reads.length, reads);
  // An inline partial is not looked up in the loader.
  assert.strictEqual(
    (await renderer.render({ template: 'other' })).html,
    'inline<footer>©</footer>',
  );
  assert.ok(!loader.reads.includes('local.hbs'));
});

test('Templates: Handlebars fails on a missing or dynamic partial and on bad syntax', async () => {
  const engine = createHandlebarsEngine({ handlebars, options: { strict: true } });
  const missing = await failureOf(renderWith(engine, { 'a.hbs': '{{> nope}}' }, { template: 'a' }));
  assert.ok(missing instanceof TemplateNotFoundError);
  assert.deepStrictEqual(missing.tried, ['nope.hbs', 'nope.handlebars', 'nope']);
  const dynamic = await failureOf(
    renderWith(engine, { 'a.hbs': '{{> (which)}}' }, { template: 'a', context: { which: 'x' } }),
  );
  assert.ok(dynamic instanceof TemplateRenderError);
  assert.strictEqual(dynamic.phase, 'render');
  const syntax = await failureOf(renderWith(engine, { 'a.hbs': '{{#if}}' }, { template: 'a' }));
  assert.strictEqual(syntax.phase, 'compile');
  // strict: true reaches compile.
  const strict = await failureOf(
    renderWith(engine, { 'a.hbs': '{{missing.key}}' }, { template: 'a' }),
  );
  assert.match(strict.message, /not defined/);
  // A string literal names a partial too.
  assert.strictEqual(
    (await renderWith(engine, { 'a.hbs': '{{> "b"}}', 'b.hbs': 'B' }, { template: 'a' })).html,
    'B',
  );
  assert.throws(() => createHandlebarsEngine({}), /needs handlebars/);
  assert.throws(() => createHandlebarsEngine({ handlebars, helpers: { x: 1 } }), /helpers.x/);
  assert.throws(() => createHandlebarsEngine({ handlebars, helpers: [] }), /object of functions/);
  assert.throws(() => createHandlebarsEngine({ handlebars, configure: 1 }), /configure/);
});

test('Templates: a partial that fails to load is read again on the next render', async () => {
  let fail = true;
  const loader = {
    load: (name) => {
      if (name === 'a.hbs') return { name, source: '{{> b}}' };
      if (name === 'b.hbs' && fail) throw new Error('flaky');
      return name === 'b.hbs' ? { name, source: 'B' } : undefined;
    },
  };
  const renderer = createTemplateRenderer({
    engine: createHandlebarsEngine({ handlebars }),
    loader,
  });
  await assert.rejects(renderer.render({ template: 'a' }), /flaky/);
  fail = false;
  renderer.clear();
  assert.strictEqual((await renderer.render({ template: 'a' })).html, 'B');
});

test('Templates: Mustache fails on a missing partial, where it rendered nothing', async () => {
  const engine = createMustacheEngine({ mustache });
  assert.strictEqual(
    (
      await renderWith(
        engine,
        { 'a.mustache': '{{name}}{{> b}}', 'b.mustache': '[{{name}}]' },
        { template: 'a', context: { name: '<x>' } },
      )
    ).html,
    '&lt;x&gt;[&lt;x&gt;]',
  );
  const missing = await failureOf(
    renderWith(engine, { 'a.mustache': '{{> nope}}' }, { template: 'a' }),
  );
  assert.ok(missing instanceof TemplateNotFoundError);
  const syntax = await failureOf(
    renderWith(engine, { 'a.mustache': '{{#open}}' }, { template: 'a' }),
  );
  assert.strictEqual(syntax.phase, 'compile');
  const tagged = createMustacheEngine({ mustache, tags: ['<%', '%>'] });
  assert.strictEqual(
    (
      await renderWith(
        tagged,
        { 'a.mustache': '<% name %>' },
        { template: 'a', context: { name: 'y' } },
      )
    ).html,
    'y',
  );
  // Its writer keeps what it parses, and clear() empties it.
  const renderer = createTemplateRenderer({
    engine,
    loader: createMemoryLoader({ 'a.mustache': 'a' }),
  });
  await renderer.render({ template: 'a' });
  await renderer.render({ template: 'a' });
  renderer.clear();
  assert.throws(() => createMustacheEngine({}), /needs mustache/);
  assert.throws(() => createMustacheEngine({ mustache, tags: ['<%'] }), /two strings/);
  // Without a cache, its writer keeps nothing.
  const uncached = createTemplateRenderer({
    engine,
    loader: createMemoryLoader({ 'a.mustache': 'a' }),
    cache: false,
  });
  assert.strictEqual((await uncached.render({ template: 'a' })).html, 'a');
});

test('Templates: Pug reads include and extends through the loader, its locals the context alone', async () => {
  const engine = createPugEngine({ pug, options: { doctype: 'html' } });
  const templates = {
    'emails/welcome.pug':
      'extends ../layouts/main\nblock content\n  p= name\n  p= filename\n  include footer\n  include /legal',
    'layouts/main.pug': 'html\n  body\n    block content',
    'emails/footer.pug': 'footer bye',
    'legal.pug': 'small legal',
  };
  // Before: options were merged over the context, so `filename` was Pug's.
  const output = await renderWith(engine, templates, {
    template: 'emails/welcome',
    context: { name: '<Ada>', filename: 'mine' },
  });
  assert.strictEqual(
    output.html,
    '<!DOCTYPE html><html><body><p>&lt;Ada&gt;</p><p>mine</p><footer>bye</footer><small>legal</small></body></html>',
  );
  const missing = await failureOf(
    renderWith(engine, { 'a.pug': 'include nope' }, { template: 'a' }),
  );
  assert.ok(missing instanceof TemplateNotFoundError);
  const out = await failureOf(
    renderWith(engine, { 'a.pug': 'include ../../etc/passwd' }, { template: 'a' }),
  );
  assert.ok(out instanceof TemplateNotFoundError);
  assert.throws(() => createPugEngine({}), /needs pug/);
  for (const name of ['filename', 'basedir', 'cache']) {
    assert.throws(() => createPugEngine({ pug, options: { [name]: '/' } }), new RegExp(name));
  }
  // A plugin of the application's runs beside the loader's.
  const seen = [];
  const preCodeGen = (ast) => {
    seen.push(ast.type);
    return ast;
  };
  const plugged = createPugEngine({ pug, options: { plugins: [{ preCodeGen }] } });
  await renderWith(plugged, { 'a.pug': 'p x' }, { template: 'a' });
  assert.deepStrictEqual(seen, ['Block']);
});

test('Templates: MJML renders after the engine inside it, whose errors reach it', async () => {
  const inner = createHandlebarsEngine({ handlebars });
  const engine = createMjmlEngine({ mjml2html, engine: inner, onErrors: () => {} });
  assert.deepStrictEqual(engine.extensions, ['.mjml.hbs', '.mjml.handlebars']);
  const source =
    '---\nsubject: Hi {{name}}\n---\n<mjml><mj-body><mj-section><mj-column><mj-text>Hi {{name}}</mj-text></mj-column></mj-section></mj-body></mjml>';
  const output = await renderWith(
    engine,
    { 'a.mjml.hbs': source },
    { template: 'a', context: { name: 'Ada' } },
  );
  assert.match(output.html, /^<!doctype html>/i);
  assert.match(output.html, /Hi Ada/);
  assert.strictEqual(output.text, 'Hi Ada');
  assert.strictEqual(output.subject, 'Hi Ada');
  // Before: the error of the inner engine was dropped and MJML rendered
  // `undefined`.
  const broken = await failureOf(
    renderWith(engine, { 'a.mjml.hbs': '{{#if}}' }, { template: 'a' }),
  );
  assert.ok(broken instanceof TemplateRenderError);
  assert.strictEqual(broken.phase, 'compile');
});

test('Templates: a static MJML renders, which @nestjs-modules/mailer could not', async () => {
  const engine = createMjmlEngine({ mjml2html });
  const output = await renderWith(
    engine,
    {
      'a.mjml':
        '<mjml><mj-body><mj-section><mj-column><mj-text>Static</mj-text></mj-column></mj-section></mj-body></mjml>',
      'a.subject.mjml': 'Static subject',
    },
    { template: 'a' },
  );
  assert.match(output.html, /Static/);
  assert.strictEqual(output.subject, 'Static subject');
});

test('Templates: what MJML finds wrong is heard, and fails the render when strict', async (t) => {
  const bad =
    '<mjml><mj-body><mj-section><mj-column><mj-unknown/></mj-column></mj-section></mj-body></mjml>';
  const heard = [];
  const soft = createMjmlEngine({
    mjml2html,
    onErrors: (errors, template) => heard.push([errors.length, template]),
  });
  await renderWith(soft, { 'a.mjml': bad }, { template: 'a' });
  assert.deepStrictEqual(heard, [[1, 'a.mjml']]);
  const warnings = [];
  const listener = (warning) => warnings.push(warning);
  process.on('warning', listener);
  t.after(() => process.off('warning', listener));
  await renderWith(createMjmlEngine({ mjml2html }), { 'b.mjml': bad }, { template: 'b' });
  await new Promise(setImmediate);
  assert.ok(warnings.some((warning) => warning.code === 'MAILER_TEMPLATE_MJML'));
  const strict = createMjmlEngine({ mjml2html, options: { validationLevel: 'strict' } });
  const error = await failureOf(renderWith(strict, { 'c.mjml': bad }, { template: 'c' }));
  assert.ok(error instanceof TemplateRenderError);
  const noHtml = createMjmlEngine({ mjml2html: () => ({}) });
  assert.match(
    (await failureOf(renderWith(noHtml, { 'd.mjml': bad }, { template: 'd' }))).message,
    /no html/,
  );
  assert.throws(() => createMjmlEngine({}), /needs mjml2html/);
  assert.throws(() => createMjmlEngine({ mjml2html, engine: {} }), /must be a template engine/);
  assert.throws(
    () => createMjmlEngine({ mjml2html, includes: 'yes' }),
    /includes must be a boolean/,
  );
  for (const name of ['filePath', 'ignoreIncludes', 'includePath', 'mjmlConfigPath', 'skeleton']) {
    assert.throws(() => createMjmlEngine({ mjml2html, options: { [name]: 1 } }), new RegExp(name));
  }
});

test('Templates: MJML reads mj-include only when let, and from the template on disk', async () => {
  const calls = [];
  const fake = (mjml, options) => {
    calls.push(options);
    return { html: `<html>${mjml}</html>`, errors: [] };
  };
  const loader = { load: (name) => ({ name, source: '<mjml/>', path: '/emails/a.mjml' }) };
  for (const includes of [false, true]) {
    const engine = createMjmlEngine({ mjml2html: fake, includes });
    await createTemplateRenderer({ engine, loader }).render({ template: 'a' });
  }
  assert.deepStrictEqual(calls[0], { validationLevel: 'soft', ignoreIncludes: true });
  assert.deepStrictEqual(calls[1], {
    validationLevel: 'soft',
    ignoreIncludes: false,
    filePath: '/emails/a.mjml',
  });
});

test('Templates: Liquid escapes by default, its includes and layouts through the loader', async () => {
  const engine = createLiquidEngine({
    Liquid,
    filters: { shout: (value) => `${value}!` },
    configure: (liquid) => liquid.registerFilter('whisper', (value) => value.toLowerCase()),
  });
  const templates = {
    'emails/welcome.liquid':
      '{% layout "layouts/main" %}{% block content %}<p>{{ name | shout }}</p>{% render "footer" %}{% include "./sign" %}{{ raw | raw }}{% endblock %}',
    'layouts/main.liquid': '<html>{% block content %}{% endblock %}</html>',
    'partials/footer.liquid': '<footer>{{ "BYE" | whisper }}</footer>',
    'emails/sign.liquid': '<i>sign</i>',
  };
  // Before: liquidjs escapes nothing unless told.
  const output = await renderWith(
    engine,
    templates,
    { template: 'emails/welcome', context: { name: '<Ada>', raw: '<b>b</b>' } },
    { partials: ['partials'] },
  );
  assert.strictEqual(
    output.html,
    '<html><p>&lt;Ada&gt;!</p><footer>bye</footer><i>sign</i><b>b</b></html>',
  );
  const missing = await failureOf(
    renderWith(engine, { 'a.liquid': '{% render "nope" %}' }, { template: 'a' }),
  );
  assert.ok(missing instanceof TemplateRenderError || missing instanceof TemplateNotFoundError);
  const out = await failureOf(
    renderWith(engine, { 'a.liquid': '{% include "../../x" %}' }, { template: 'a' }),
  );
  assert.ok(out instanceof Error);
  // Own properties only: a prototype's are not read.
  const proto = Object.create({ secret: 's' });
  assert.strictEqual(
    (
      await renderWith(
        engine,
        { 'a.liquid': '[{{ o.secret }}]' },
        { template: 'a', context: { o: proto } },
      )
    ).html,
    '[]',
  );
  assert.throws(() => createLiquidEngine({}), /needs Liquid/);
  for (const name of ['root', 'fs', 'partials', 'cache']) {
    assert.throws(() => createLiquidEngine({ Liquid, options: { [name]: 1 } }), new RegExp(name));
  }
  // A template with an extension of its own.
  assert.strictEqual(
    (
      await renderWith(
        engine,
        { 'a.liquid': '{% render "b.html" %}', 'b.html': 'B' },
        { template: 'a' },
      )
    ).html,
    'B',
  );
});

test('Templates: Liquid reads synchronously too, through its loader', async () => {
  // liquidjs renders synchronously with existsSync and readFileSync of its
  // file system, which are the loader's too.
  let liquid;
  const engine = createLiquidEngine({ Liquid, configure: (instance) => (liquid = instance) });
  const renderer = createTemplateRenderer({
    engine,
    loader: createMemoryLoader({ 'a.liquid': 'x', 'b.liquid': 'B{{ n }}' }),
  });
  await renderer.render({ template: 'a' });
  assert.strictEqual(liquid.parseAndRenderSync('{% render "b", n: 1 %}'), 'B1');
  assert.throws(() => liquid.parseAndRenderSync('{% render "nope" %}'), /nope/);
  assert.throws(() => liquid.parseAndRenderSync('{% render "../../x" %}'));
  await assert.rejects(liquid.parseAndRender('{% render "nope" %}'), /nope/);
});

test('Templates: Nunjucks autoescapes, extends and includes through the loader', async () => {
  const engine = createNunjucksEngine({
    nunjucks,
    filters: { shout: (value) => `${value}!` },
    configure: (env) => env.addGlobal('site', 'S'),
  });
  const templates = {
    'emails/welcome.njk':
      '{% extends "layouts/main.njk" %}{% block content %}<p>{{ name | shout }}</p>{% include "./footer.njk" %}{{ site }}{% endblock %}',
    'layouts/main.njk': '<html>{% block content %}{% endblock %}</html>',
    'emails/footer.njk': '<footer>bye</footer>',
  };
  const output = await renderWith(engine, templates, {
    template: 'emails/welcome',
    context: { name: '<Ada>' },
  });
  assert.strictEqual(output.html, '<html><p>&lt;Ada&gt;!</p><footer>bye</footer>S</html>');
  // A missing include stays a missing template, under the error Nunjucks makes.
  const missing = await failureOf(
    renderWith(engine, { 'a.njk': '{% include "nope.njk" %}' }, { template: 'a' }),
  );
  assert.ok(missing instanceof TemplateNotFoundError);
  const syntax = await failureOf(renderWith(engine, { 'a.njk': '{% if %}' }, { template: 'a' }));
  assert.ok(syntax instanceof TemplateRenderError);
  const thrown = await failureOf(
    renderWith(
      engine,
      { 'a.njk': '{{ boom() }}' },
      {
        template: 'a',
        context: {
          boom: () => {
            throw new Error('boom');
          },
        },
      },
    ),
  );
  assert.ok(thrown instanceof TemplateRenderError);
  assert.strictEqual(thrown.phase, 'render');
  assert.throws(() => createNunjucksEngine({}), /needs nunjucks/);
  assert.throws(() => createNunjucksEngine({ nunjucks: { Environment: class {} } }), /no Template/);
  // Without a cache, Nunjucks keeps no template.
  const uncached = createTemplateRenderer({
    engine,
    loader: createMemoryLoader(templates),
    cache: false,
  });
  assert.match(
    (await uncached.render({ template: 'emails/welcome', context: { name: 'x' } })).html,
    /x!/,
  );
});

test('Templates: Eta includes and lays out through the loader, relative to the file', async () => {
  const engine = createEtaEngine({ Eta });
  const templates = {
    'emails/welcome.eta':
      '<% layout("../layouts/main") %><p><%= it.name %></p><%~ include("./footer", it) %><%~ include("/legal") %>',
    'layouts/main.eta': '<html><%~ it.body %></html>',
    'emails/footer.eta': '<footer><%= it.name %></footer>',
    'legal.eta': '<small/>',
  };
  const output = await renderWith(engine, templates, {
    template: 'emails/welcome',
    context: { name: '<Ada>' },
  });
  assert.strictEqual(
    output.html,
    '<html><p>&lt;Ada&gt;</p><footer>&lt;Ada&gt;</footer><small/></html>',
  );
  const missing = await failureOf(
    renderWith(engine, { 'a.eta': '<%~ include("nope") %>' }, { template: 'a' }),
  );
  assert.ok(missing instanceof TemplateNotFoundError);
  const asyncEngine = createEtaEngine({ Eta, async: true });
  const awaited = await renderWith(
    asyncEngine,
    { 'a.eta': '<%= await it.value %><%~ await includeAsync("b", it) %>', 'b.eta': '[b]' },
    { template: 'a', context: { value: Promise.resolve('v') } },
  );
  assert.strictEqual(awaited.html, 'v[b]');
  assert.throws(() => createEtaEngine({}), /needs Eta/);
  assert.throws(() => createEtaEngine({ Eta, async: 'yes' }), /async must be a boolean/);
  assert.throws(() => createEtaEngine({ Eta, options: { views: '/' } }), /views/);
});

test('Templates: an engine that reads synchronously needs a loader with loadSync', async () => {
  const loader = {
    load: (name) => (name === 'a.ejs' ? { name, source: '<%- include("b") %>' } : undefined),
  };
  const renderer = createTemplateRenderer({ engine: createEjsEngine({ ejs }), loader });
  const error = await failureOf(renderer.render({ template: 'a' }));
  assert.ok(error instanceof TemplateRenderError);
  assert.match(error.message, /loadSync/);
});

test('Templates: React Email components are templates, each with its subject', async () => {
  const Welcome = ({ name }) => React.createElement('p', null, `Hi ${name}`);
  const engine = createReactEmailEngine({
    render,
    createElement: React.createElement,
    components: {
      welcome: { component: Welcome, subject: ({ name }) => `Welcome, ${name}` },
      'welcome.uk': {
        component: ({ name }) => React.createElement('p', null, `Привіт ${name}`),
        subject: 'Вітаємо',
      },
      plain: Welcome,
    },
  });
  const renderer = createTemplateRenderer({ engine });
  const en = await renderer.render({ template: 'welcome', context: { name: 'Ada' } });
  assert.match(en.html, /<p>Hi Ada<\/p>/);
  assert.strictEqual(en.text, 'Hi Ada');
  assert.strictEqual(en.subject, 'Welcome, Ada');
  const uk = await renderer.render({ template: 'welcome', context: { name: 'Ada' }, locale: 'uk' });
  assert.deepStrictEqual([uk.subject, uk.locale], ['Вітаємо', 'uk']);
  const plain = await renderer.render({ template: 'plain', context: { name: 'B' } });
  assert.strictEqual(plain.subject, undefined);
  assert.throws(() => createReactEmailEngine({ render }), /createElement/);
  assert.throws(
    () => createReactEmailEngine({ render, createElement: React.createElement }),
    /components/,
  );
  assert.throws(
    () =>
      createReactEmailEngine({ render, createElement: React.createElement, components: { a: 1 } }),
    /component or \{ component \}/,
  );
  assert.throws(
    () =>
      createReactEmailEngine({
        render,
        createElement: React.createElement,
        components: { a: { component: Welcome, subject: 1 } },
      }),
    /subject of a/,
  );
  // Its text and subject come with its HTML: a variant of them is no template of its own.
  assert.throws(
    () => engine.compile({ component: Welcome }, { name: 'a.text', part: 'text' }),
    /gives its text and subject itself/,
  );
});

test('Templates: juice and css-inline inline the CSS and fetch nothing', async () => {
  const html =
    '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><style>p{color:red}</style></head><body><p>x</p></body></html>';
  // Before: css-inline fetched every remote stylesheet on each send and
  // dropped the <link> of the font.
  for (const inliner of [createCssInliner({ inline: juice }), createCssInliner({ inline })]) {
    const inlined = await inliner(html);
    assert.match(inlined, /<p style="color: ?red;?">x<\/p>/);
    assert.match(inlined, /fonts\.googleapis\.com/);
  }
});
