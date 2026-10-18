// Not ported: tests of the template renderer of ./templates, against the fake
// engine of tests/helpers/templates.
const { test } = require('node:test');
const assert = require('node:assert');
const { renderContent, renderFields } = require('../../src/render/index.js');
const {
  createCssInliner,
  createMemoryLoader,
  createTemplateRenderer,
  TemplateLoadError,
  TemplateNotFoundError,
  TemplateRenderError,
} = require('../../src/templates/index.js');
const { fakeEngine } = require('../helpers/templates/fake-engine.js');

const rendererOf = (templates, options = {}) => {
  const engine = options.engine ?? fakeEngine();
  const renderer = createTemplateRenderer({
    engine,
    loader: createMemoryLoader(templates),
    ...options,
  });
  return { renderer, engine };
};

test('Templates: a template renders its HTML, its text derived', async () => {
  const { renderer } = rendererOf({ 'welcome.tpl': '<p>Hi {{name}}</p>' });
  assert.deepStrictEqual(await renderer.render({ template: 'welcome', context: { name: 'A&B' } }), {
    template: 'welcome.tpl',
    html: '<p>Hi A&amp;B</p>',
    text: 'Hi A&B',
  });
  // An explicit extension names the engine, and the result is the same.
  assert.strictEqual(
    (await renderer.render({ template: 'welcome.tpl', context: { name: 'x' } })).html,
    '<p>Hi x</p>',
  );
  const { renderer: noText } = rendererOf({ 'a.tpl': '<p>x</p>' }, { autoText: false });
  assert.deepStrictEqual(await noText.render({ template: 'a' }), {
    template: 'a.tpl',
    html: '<p>x</p>',
  });
});

test('Templates: the subject comes from the front matter, the text from its variant', async () => {
  const { renderer } = rendererOf({
    'reset.tpl': '---\n# a comment\nsubject: "Reset, {{name}} &amp; co"\n---\n<p>{{url}}</p>',
    'reset.text.tpl': 'Open {{url}} &amp; go',
  });
  const output = await renderer.render({
    template: 'reset',
    context: { name: 'Ada', url: 'https://example.com/r?a=1&b=2' },
  });
  assert.strictEqual(output.subject, 'Reset, Ada & co');
  assert.strictEqual(output.text, 'Open https://example.com/r?a=1&b=2 & go');
  assert.strictEqual(output.html, '<p>https://example.com/r?a=1&amp;b=2</p>');
  // Its subject variant, its whitespace collapsed.
  const { renderer: variant } = rendererOf({
    'a.tpl': '<p>x</p>',
    'a.subject.tpl': '  Hello\n  {{name}}\n',
  });
  assert.strictEqual(
    (await variant.render({ template: 'a', context: { name: 'B' } })).subject,
    'Hello B',
  );
  // renderFields and renderContent take the renderer.
  assert.deepStrictEqual(
    await renderFields(renderer, { template: 'reset', context: { url: 'u' } }),
    {
      subject: 'Reset, & co',
      content: { html: '<p>u</p>', text: 'Open u & go' },
    },
  );
  assert.deepStrictEqual(await renderContent(variant, { template: 'a' }), {
    html: '<p>x</p>',
    text: 'x',
  });
});

test('Templates: a template of text alone', async () => {
  const { renderer } = rendererOf({
    'note.text.tpl': '---\nsubject: Note\n---\nHi {{name}} &amp; all',
  });
  assert.deepStrictEqual(await renderer.render({ template: 'note', context: { name: '<b>' } }), {
    template: 'note.text.tpl',
    text: 'Hi <b> & all',
    subject: 'Note',
  });
});

test('Templates: locales fall back by subtag, then the default, then none', async () => {
  const { renderer } = rendererOf(
    {
      'welcome.tpl': '---\nsubject: Welcome\n---\n<p>Hi</p>',
      'welcome.uk.tpl': '---\nsubject: Вітаємо\n---\n<p>Привіт</p>',
      'welcome.de.tpl': '<p>Hallo</p>',
    },
    { defaultLocale: 'de-AT' },
  );
  const uk = await renderer.render({ template: 'welcome', locale: 'uk-UA' });
  assert.deepStrictEqual([uk.template, uk.locale, uk.subject], ['welcome.uk.tpl', 'uk', 'Вітаємо']);
  const fr = await renderer.render({ template: 'welcome', locale: 'fr' });
  assert.deepStrictEqual([fr.template, fr.locale], ['welcome.de.tpl', 'de']);
  // The subject is that of the locale the body was found at: none here, not
  // the English one.
  assert.strictEqual(fr.subject, undefined);
  const { renderer: plain } = rendererOf({ 'welcome.tpl': '<p>Hi</p>' });
  const none = await plain.render({ template: 'welcome', locale: 'EN-us' });
  assert.deepStrictEqual([none.template, none.locale], ['welcome.tpl', undefined]);
  await assert.rejects(plain.render({ template: 'welcome', locale: 'not a tag' }), RangeError);
});

test('Templates: a missing template names what was tried, and is not retryable', async () => {
  const { renderer } = rendererOf({}, { defaultLocale: 'en' });
  const error = await renderer.render({ template: 'nope', locale: 'uk' }).catch((e) => e);
  assert.ok(error instanceof TemplateNotFoundError);
  assert.strictEqual(error.code, 'MAILER_TEMPLATE_NOT_FOUND');
  assert.strictEqual(error.retryable, false);
  assert.deepStrictEqual(error.tried, [
    'nope.uk.tpl',
    'nope.en.tpl',
    'nope.tpl',
    'nope.uk.text.tpl',
    'nope.en.text.tpl',
    'nope.text.tpl',
  ]);
  const many = new TemplateNotFoundError('x', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.match(many.message, /8, and 2 more|8 and 2 more/);
});

test('Templates: a name is never a path', async () => {
  const { renderer } = rendererOf({});
  for (const template of ['../secret', '/etc/passwd', 'a//b', 'a/./b', 'a\\b', '', '.hidden', 42]) {
    await assert.rejects(renderer.render({ template }), TypeError, String(template));
  }
  await assert.rejects(renderer.render(null), TypeError);
  await assert.rejects(renderer.render({ template: 'a', context: [] }), TypeError);
  await assert.rejects(renderer.render({ template: 'a', locale: 1 }), TypeError);
});

test('Templates: includes are read through the loader, from the root or the partials', async () => {
  const { renderer } = rendererOf(
    {
      'emails/welcome.tpl': '{{> header}}<p>{{name}}</p>{{> ./sign}}{{> /legal}}',
      'partials/header.tpl': '<header/>',
      'emails/sign.tpl': '<i>sign</i>',
      'legal.tpl': '<small>legal</small>',
    },
    { partials: ['partials'] },
  );
  assert.strictEqual(
    (await renderer.render({ template: 'emails/welcome', context: { name: 'x' } })).html,
    '<header/><p>x</p><i>sign</i><small>legal</small>',
  );
  const { renderer: out } = rendererOf({ 'a.tpl': '{{> ../../etc/passwd}}' });
  const error = await out.render({ template: 'a' }).catch((e) => e);
  assert.ok(error instanceof TemplateNotFoundError);
  assert.deepStrictEqual(error.tried, []);
  assert.strictEqual(error.from, 'a.tpl');
});

test('Templates: a layout wraps the HTML, opted out or named by front matter', async () => {
  const templates = {
    'layouts/main.tpl': '<html>{{title}}{{{body}}}</html>',
    'layouts/alt.tpl': '<alt>{{{body}}}</alt>',
    'a.tpl': '<p>{{name}}</p>',
    'b.tpl': '---\nlayout: none\n---\n<p>b</p>',
    'c.tpl': '---\nlayout: layouts/alt\n---\n<p>c</p>',
    'd.tpl': '---\nlayout: layouts/missing\n---\n<p>d</p>',
    'layouts/nested.tpl': '---\nlayout: layouts/main\n---\n{{{body}}}',
    'e.tpl': '---\nlayout: layouts/nested\n---\n<p>e</p>',
    'f.text.tpl': 'text alone',
  };
  const { renderer } = rendererOf(templates, {
    layout: 'layouts/main',
    globals: { title: 'T' },
  });
  assert.strictEqual(
    (await renderer.render({ template: 'a', context: { name: 'x' } })).html,
    '<html>T<p>x</p></html>',
  );
  assert.strictEqual((await renderer.render({ template: 'b' })).html, '<p>b</p>');
  assert.strictEqual((await renderer.render({ template: 'c' })).html, '<alt><p>c</p></alt>');
  const missing = await renderer.render({ template: 'd' }).catch((e) => e);
  assert.ok(missing instanceof TemplateNotFoundError);
  assert.strictEqual(missing.from, 'd.tpl');
  const nested = await renderer.render({ template: 'e' }).catch((e) => e);
  assert.ok(nested instanceof TemplateRenderError);
  assert.strictEqual(nested.phase, 'layout');
  // A template of text alone takes no layout.
  assert.deepStrictEqual(await renderer.render({ template: 'f' }), {
    template: 'f.text.tpl',
    text: 'text alone',
  });
  // A layout of text alone has no HTML to wrap with.
  const { renderer: textLayout } = rendererOf(
    { 'a.tpl': '<p>a</p>', 'l.text.tpl': 'x' },
    { layout: 'l' },
  );
  const noHtml = await textLayout.render({ template: 'a' }).catch((e) => e);
  assert.strictEqual(noHtml.phase, 'layout');
});

test('Templates: globals sit under the context, per input when a function', async () => {
  const { renderer } = rendererOf(
    { 'a.tpl': '{{who}} {{site}} {{locale}}' },
    { globals: async (input) => ({ who: 'all', site: 'S', locale: input.locale ?? '-' }) },
  );
  assert.strictEqual(
    (await renderer.render({ template: 'a', context: { who: 'me' }, locale: 'uk' })).html,
    'me S uk',
  );
  const { renderer: bad } = rendererOf({ 'a.tpl': 'x' }, { globals: () => 42 });
  await assert.rejects(bad.render({ template: 'a' }), /globals must give an object/);
  // A failure of globals, such as an i18n backend that is down, stays as it is.
  const down = new Error('i18n down');
  const { renderer: failing } = rendererOf(
    { 'a.tpl': 'x' },
    { globals: () => Promise.reject(down) },
  );
  assert.strictEqual(await failing.render({ template: 'a' }).catch((e) => e), down);
  const { renderer: none } = rendererOf({ 'a.tpl': 'x{{y}}' }, { globals: () => undefined });
  assert.strictEqual((await none.render({ template: 'a', context: { y: 1 } })).html, 'x1');
});

test('Templates: each template is compiled once, concurrent renders included', async () => {
  const engine = fakeEngine({ async: true });
  const { renderer } = rendererOf(
    { 'a.tpl': '---\nsubject: S {{n}}\n---\n<p>{{n}}</p>{{> p}}', 'p.tpl': '<i/>' },
    { engine },
  );
  const outputs = await Promise.all([
    renderer.render({ template: 'a', context: { n: 1 } }),
    renderer.render({ template: 'a', context: { n: 2 } }),
    renderer.render({ template: 'a', context: { n: 3 } }),
  ]);
  assert.deepStrictEqual(
    outputs.map((output) => output.subject),
    ['S 1', 'S 2', 'S 3'],
  );
  assert.strictEqual(engine.compiled.length, 2, 'the body and the subject, once');
  renderer.clear();
  await renderer.render({ template: 'a', context: { n: 4 } });
  assert.strictEqual(engine.compiled.length, 4);
  // Without a cache, each render compiles anew.
  const fresh = fakeEngine();
  const { renderer: uncached } = rendererOf({ 'a.tpl': '<p/>' }, { engine: fresh, cache: false });
  await uncached.render({ template: 'a' });
  await uncached.render({ template: 'a' });
  assert.strictEqual(fresh.compiled.length, 2);
  // A cache of one entry drops the oldest.
  const small = fakeEngine();
  const { renderer: bounded } = rendererOf(
    { 'a.tpl': 'a', 'b.tpl': 'b' },
    { engine: small, cache: { maxEntries: 1 } },
  );
  await bounded.render({ template: 'a' });
  await bounded.render({ template: 'b' });
  await bounded.render({ template: 'a' });
  assert.strictEqual(small.compiled.length, 3);
});

test('Templates: a template that is missing at first is found once it is there', async () => {
  const sources = Object.create(null);
  const loader = {
    load: (name) => (name in sources ? { name, source: sources[name] } : undefined),
  };
  const renderer = createTemplateRenderer({ engine: fakeEngine(), loader });
  await assert.rejects(renderer.render({ template: 'late' }), TemplateNotFoundError);
  sources['late.tpl'] = '<p>late</p>';
  renderer.clear();
  assert.strictEqual((await renderer.render({ template: 'late' })).html, '<p>late</p>');
});

test('Templates: failures are classified by phase, the engine error their cause', async () => {
  const { renderer } = rendererOf({
    'syntax.tpl': '<p>{{!syntax</p>',
    'boom.tpl': '<p>{{x}}</p>',
    'front.tpl': '---\nsubjct: typo\n---\n<p/>',
    'open.tpl': '---\nsubject: x\n',
    'line.tpl': '---\nnot a pair\n---\n',
    'twice.tpl': '---\nsubject: a\nsubject: b\n---\n',
  });
  const syntax = await renderer.render({ template: 'syntax' }).catch((e) => e);
  assert.ok(syntax instanceof TemplateRenderError);
  assert.deepStrictEqual(
    [syntax.phase, syntax.engine, syntax.code],
    ['compile', 'fake', 'MAILER_TEMPLATE_RENDER'],
  );
  assert.ok(syntax.cause instanceof SyntaxError);
  assert.strictEqual(syntax.retryable, false);
  const boom = await renderer
    .render({ template: 'boom', context: { explode: true } })
    .catch((e) => e);
  assert.strictEqual(boom.phase, 'render');
  assert.match(boom.message, /A helper exploded/);
  for (const [template, pattern] of [
    ['front', /no key "subjct"/],
    ['open', /no closing ---/],
    ['line', /not "key: value"/],
    ['twice', /subject twice/],
  ]) {
    const error = await renderer.render({ template }).catch((e) => e);
    assert.strictEqual(error.phase, 'front-matter', template);
    assert.match(error.message, pattern);
  }
});

test('Templates: a loader that fails fails as a load of its template, which may pass on a retry', async () => {
  // Before: the loader's error came back as it was, naming no template.
  const outage = Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' });
  const loader = {
    load: (name) => {
      if (name === 'b.tpl') throw outage;
      return name === 'a.tpl' ? { name, source: '{{> b}}' } : undefined;
    },
  };
  const renderer = createTemplateRenderer({ engine: fakeEngine(), loader });
  const include = await renderer.render({ template: 'a' }).catch((e) => e);
  assert.ok(include instanceof TemplateLoadError);
  assert.deepStrictEqual(
    [include.code, include.template, include.retryable, include.cause],
    ['MAILER_TEMPLATE_LOAD', 'b.tpl', true, outage],
  );
  assert.match(include.message, /The template "b.tpl" failed to load: EMFILE/);
  const failing = createTemplateRenderer({
    engine: fakeEngine(),
    loader: { load: () => Promise.reject(outage) },
  });
  const main = await failing.render({ template: 'x' }).catch((e) => e);
  assert.deepStrictEqual([main.template, main.cause], ['x.tpl', outage]);
  // A bug of the loader, or an error that says so, is left for the queue to
  // classify by its cause, never marked retryable.
  for (const cause of [new TypeError('x is undefined'), { retryable: false, message: 'gone' }]) {
    const buggy = createTemplateRenderer({
      engine: fakeEngine(),
      loader: {
        load: () => {
          throw cause;
        },
      },
    });
    const error = await buggy.render({ template: 'x' }).catch((e) => e);
    assert.ok(error instanceof TemplateLoadError);
    assert.ok(!('retryable' in error));
  }
  // A loader that throws an error of ./templates throws it as it is.
  const refusal = new TemplateNotFoundError('x', []);
  const own = createTemplateRenderer({
    engine: fakeEngine(),
    loader: {
      load: () => {
        throw refusal;
      },
    },
  });
  assert.strictEqual(await own.render({ template: 'x' }).catch((e) => e), refusal);
});

test('Templates: finish makes the HTML of the outermost template, then the CSS is inlined', async () => {
  const order = [];
  const engine = fakeEngine({
    finish: (html, context) => {
      order.push(`finish ${context.name}`);
      return html.replace('<mj>', '<table>');
    },
  });
  const inline = (html, options) => {
    order.push(`inline ${JSON.stringify(options)}`);
    return html.replace('<p>', '<p style="color:red">');
  };
  const { renderer } = rendererOf(
    { 'a.tpl': '<p>a</p>', 'layout.tpl': '<mj>{{{body}}}' },
    { engine, layout: 'layout', inlineCss: createCssInliner({ inline }) },
  );
  const output = await renderer.render({ template: 'a' });
  assert.strictEqual(output.html, '<table><p style="color:red">a</p>');
  assert.deepStrictEqual(order, [
    'finish layout.tpl',
    'inline {"loadRemoteStylesheets":false,"keepLinkTags":true}',
  ]);
  // A failure of the inliner rejects once, as a failure of its phase.
  const { renderer: failing } = rendererOf(
    { 'a.tpl': '<p/>' },
    {
      inlineCss: createCssInliner({
        inline: () => {
          throw new Error('bad css');
        },
      }),
    },
  );
  const error = await failing.render({ template: 'a' }).catch((e) => e);
  assert.strictEqual(error.phase, 'inline-css');
  const { renderer: notString } = rendererOf(
    { 'a.tpl': '<p/>' },
    { inlineCss: createCssInliner({ inline: () => 1 }) },
  );
  assert.strictEqual(
    (await notString.render({ template: 'a' }).catch((e) => e)).phase,
    'inline-css',
  );
  const { renderer: overridden } = rendererOf(
    { 'a.tpl': '<p/>' },
    {
      inlineCss: createCssInliner({
        inline: (html, o) => `${html}${o.keepLinkTags}`,
        options: { keepLinkTags: false },
      }),
    },
  );
  assert.strictEqual((await overridden.render({ template: 'a' })).html, '<p/>false');
});

test('Templates: an engine that renders its parts gives HTML, text and subject at once', async () => {
  const parts = {
    name: 'parts',
    extensions: [],
    compile: (source) => (scope) => ({
      html: `<b>${scope.n}</b>`,
      text: `t${scope.n}`,
      subject: source,
    }),
  };
  const renderer = createTemplateRenderer({
    engine: parts,
    loader: createMemoryLoader({ welcome: 'Subject  here' }),
    layout: 'ignored',
  });
  assert.deepStrictEqual(await renderer.render({ template: 'welcome', context: { n: 1 } }), {
    template: 'welcome',
    html: '<b>1</b>',
    text: 't1',
    subject: 'Subject here',
  });
  const empty = createTemplateRenderer({
    engine: { ...parts, compile: () => () => ({}) },
    loader: createMemoryLoader({ x: '' }),
  });
  assert.match(
    (await empty.render({ template: 'x' }).catch((e) => e)).message,
    /neither html nor text/,
  );
  const wrong = createTemplateRenderer({
    engine: { ...parts, compile: () => () => ({ html: 1 }) },
    loader: createMemoryLoader({ x: '' }),
  });
  assert.match(
    (await wrong.render({ template: 'x' }).catch((e) => e)).message,
    /html as no string/,
  );
  const nothing = createTemplateRenderer({
    engine: { ...parts, compile: () => () => 42 },
    loader: createMemoryLoader({ x: '' }),
  });
  assert.match((await nothing.render({ template: 'x' }).catch((e) => e)).message, /gave no string/);
  const textNotString = createTemplateRenderer({
    engine: {
      name: 'x',
      extensions: ['.x'],
      compile: (source, context) => () => (context.part === 'text' ? 1 : '<p/>'),
    },
    loader: createMemoryLoader({ 'a.x': '', 'a.text.x': '' }),
  });
  const notText = await textNotString.render({ template: 'a' }).catch((e) => e);
  assert.match(notText.message, /gave no string/);
  assert.strictEqual(notText.template, 'a.text.x');
  const notFunction = createTemplateRenderer({
    engine: { ...parts, compile: () => 'nope' },
    loader: createMemoryLoader({ x: '' }),
  });
  assert.match(
    (await notFunction.render({ template: 'x' }).catch((e) => e)).message,
    /gave no function/,
  );
});

test('Templates: engines are chosen by extension, the longest first', async () => {
  const hbs = fakeEngine({ name: 'hbs', extensions: ['.hbs'] });
  const mjml = fakeEngine({ name: 'mjml', extensions: ['.mjml.hbs'] });
  const renderer = createTemplateRenderer({
    engines: [hbs, mjml],
    loader: createMemoryLoader({ 'a.mjml.hbs': 'mjml', 'b.hbs': 'hbs', 'a.hbs': 'shadow' }),
  });
  assert.strictEqual((await renderer.render({ template: 'a.mjml.hbs' })).html, 'mjml');
  assert.strictEqual((await renderer.render({ template: 'b' })).html, 'hbs');
  // Without an extension, the engines are tried in their order.
  assert.strictEqual((await renderer.render({ template: 'a' })).html, 'shadow');
  const text = await renderer.render({ template: 'b', context: {} });
  assert.strictEqual(text.text, 'hbs');
});

test('Templates: no part of a message is longer than maxOutputBytes', async () => {
  // Before: no bound, so a template that repeated a value gave as much as it
  // could hold.
  const templates = {
    'a.tpl': '{{x}}',
    'a.text.tpl': '{{y}}',
    'b.tpl': '<p/>',
    'b.subject.tpl': '{{x}}',
    'c.tpl': '{{x}}',
    'layout.tpl': '{{{body}}}{{{body}}}',
  };
  const big = async (template, context, options) => {
    const { renderer } = rendererOf(templates, { maxOutputBytes: 30, ...options });
    return renderer.render({ template, context }).catch((e) => e);
  };
  for (const [template, context] of [
    ['a', { x: 'x'.repeat(31), y: '' }],
    ['a', { x: '', y: 'я'.repeat(16) }],
    ['b', { x: 'x'.repeat(31) }],
  ]) {
    const error = await big(template, context);
    assert.ok(error instanceof TemplateRenderError, template);
    assert.match(error.message, /more than 30 bytes \(maxOutputBytes\)/);
  }
  // Ten Cyrillic letters are 20 bytes, and need no count.
  assert.strictEqual((await big('a', { x: 'я'.repeat(10), y: 'y' })).html, 'я'.repeat(10));
  // The layout counts too.
  const layout = await big('c', { x: 'x'.repeat(20) }, { layout: 'layout' });
  assert.strictEqual(layout.phase, 'layout');
  const parts = createTemplateRenderer({
    engine: { name: 'parts', extensions: [], compile: () => () => ({ html: 'x'.repeat(40) }) },
    loader: createMemoryLoader({ x: '' }),
    maxOutputBytes: 30,
  });
  assert.match((await parts.render({ template: 'x' }).catch((e) => e)).message, /maxOutputBytes/);
  const inlined = await big(
    'b',
    {},
    { inlineCss: createCssInliner({ inline: () => 'x'.repeat(31) }) },
  );
  assert.strictEqual(inlined.phase, 'inline-css');
  const finished = await big('b', {}, { engine: fakeEngine({ finish: () => 'x'.repeat(31) }) });
  assert.strictEqual(finished.phase, 'finish');
});

test('Templates: the renderer checks its options', () => {
  const engine = fakeEngine();
  const loader = createMemoryLoader({});
  const bad = [
    [{}, /needs an engine/],
    [{ engine, engines: [engine], loader }, /not both/],
    [{ engines: [], loader }, /needs an engine/],
    [{ engine: {}, loader }, /must be a template engine/],
    [{ engine: { compile() {}, extensions: [] }, loader }, /must have a name/],
    [{ engine: { name: 'x', compile() {} }, loader }, /must list its extensions/],
    [{ engines: [engine, fakeEngine()], loader }, /Two engines take .tpl/],
    [
      { engines: [engine, { name: 'b', extensions: [], compile() {} }], loader },
      /must be the only one/,
    ],
    [{ engine }, /needs a loader/],
    [{ engine, loader, partials: 'p' }, /partials must be an array/],
    [{ engine, loader, partials: ['../p'] }, /directory of partials/],
    [{ engine, loader, layout: '/abs' }, /layout must be a template name/],
    [{ engine, loader, globals: 1 }, /globals must be an object or a function/],
    [{ engine, loader, frontMatter: 'yes' }, /frontMatter must be a boolean/],
    [{ engine, loader, autoText: 1 }, /autoText must be a boolean/],
    [{ engine, loader, cache: 'yes' }, /cache must be a boolean/],
    [{ engine, loader, cache: { maxEntries: 0 } }, /cache.maxEntries/],
    [{ engine, loader, variantName: 1 }, /variantName must be a function/],
    [{ engine, loader, inlineCss: 1 }, /inlineCss must be a function/],
    [{ engine, loader, defaultLocale: 1 }, /defaultLocale must be a string/],
    [{ engine, loader, maxIncludes: 0 }, /maxIncludes must be a positive whole number/],
    [{ engine, loader, maxIncludeDepth: 1.5 }, /maxIncludeDepth must be/],
    [{ engine, loader, maxOutputBytes: '1' }, /maxOutputBytes must be/],
  ];
  for (const [options, pattern] of bad) {
    assert.throws(() => createTemplateRenderer(options), pattern, String(pattern));
  }
  assert.throws(() => createTemplateRenderer(), /needs an engine/);
  createTemplateRenderer({ engine, loader, maxIncludes: Infinity, maxOutputBytes: Infinity });
  assert.throws(() => createCssInliner({}), /needs inline/);
  assert.throws(() => createCssInliner({ inline() {}, options: 1 }), /must be an object/);
});

test('Templates: variantName names the variants, frontMatter: false reads none', async () => {
  const { renderer } = rendererOf(
    { 'welcome-uk-html.tpl': '<p>uk</p>', 'welcome-uk-subject.tpl': 'S' },
    { variantName: (template, { locale, part }) => `${template}-${locale ?? 'x'}-${part}` },
  );
  const output = await renderer.render({ template: 'welcome', locale: 'uk' });
  assert.deepStrictEqual([output.html, output.subject], ['<p>uk</p>', 'S']);
  const { renderer: broken } = rendererOf({}, { variantName: () => 1 });
  await assert.rejects(broken.render({ template: 'a' }), /variantName must give a name/);
  const { renderer: raw } = rendererOf(
    { 'a.tpl': '---\nsubject: x\n---\n<p/>' },
    { frontMatter: false },
  );
  const plain = await raw.render({ template: 'a' });
  assert.strictEqual(plain.subject, undefined);
  assert.match(plain.html, /^---/);
  // A subject that is only whitespace is none.
  const { renderer: blank } = rendererOf({ 'a.tpl': '<p/>', 'a.subject.tpl': '   ' });
  assert.strictEqual((await blank.render({ template: 'a' })).subject, undefined);
  // A BOM before the front matter, and CRLF lines.
  const { renderer: bom } = rendererOf({ 'a.tpl': '﻿---\r\nsubject: "B"\r\n---\r\n<p/>' });
  assert.strictEqual((await bom.render({ template: 'a' })).subject, 'B');
  // A first line that only starts with --- is no front matter.
  const { renderer: rule } = rendererOf({ 'a.tpl': '----\n<p/>', 'b.tpl': '---' });
  assert.strictEqual((await rule.render({ template: 'a' })).html, '----\n<p/>');
  assert.strictEqual((await rule.render({ template: 'b' })).html, '---');
});
