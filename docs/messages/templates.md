# Templates by name

`@alexify/mailer/templates` renders a template by its name, with the engine you
already use: EJS, Handlebars, Pug, MJML, Liquid, Nunjucks, Eta, Mustache or
React Email. The package has no engine of its own and depends on none of them:
you pass the engine in, and the adapter reads its templates through a loader,
caches what it compiles, applies a layout, inlines the CSS, gives the subject
from the template, and derives the text from the HTML.

A template renderer is a [`Renderer`](/messages/render) of `./render`, so
`renderContent` and `renderFields` take it, and so does the worker of the
[queue](/guide/queue).

## Quick start

```js
const path = require('node:path');
const ejs = require('ejs');
const { createMessage } = require('@alexify/mailer');
const { renderFields } = require('@alexify/mailer/render');
const {
  createEjsEngine,
  createFileLoader,
  createTemplateRenderer,
} = require('@alexify/mailer/templates');

const templates = createTemplateRenderer({
  engine: createEjsEngine({ ejs }),
  loader: createFileLoader({ dir: path.join(__dirname, 'emails'), extensions: ['.ejs'] }),
  layout: 'layouts/letter',
  globals: { appUrl: 'https://app.example.com' },
});

const { subject, content } = await renderFields(templates, {
  template: 'reset-password',
  context: { name: user.name, url },
  locale: user.locale,
});
const message = createMessage({ from: 'no-reply@example.com', to: user.email, subject, content });
```

`emails/reset-password.ejs`:

```ejs
---
subject: Reset your password, <%= name %>
---
<p>Hi <%= name %>,</p>
<p><a href="<%= url %>">Choose a new password</a></p>
```

`emails/layouts/letter.ejs`, with the header and footer every letter shares:

```ejs
<html>
  <body>
    <img src="<%= appUrl %>/logo.png" alt="">
    <%- body %>
    <footer>…</footer>
  </body>
</html>
```

`render()` gives `{ html, text, subject, template, locale }`: the text is
derived from the HTML unless a text template is there, and `template` names the
file the message came from.

## Names, variants and locales

A template is asked for by a **name**, never a path: `welcome`,
`auth/reset-password`. A name has no `..`, no leading `/` and no `\`; the file
loader also reads nothing a symbolic link leads out of its directory to.

Each part of a message may have a file of its own, next to the HTML:

| File | Part |
| --- | --- |
| `welcome.hbs` | the HTML |
| `welcome.text.hbs` | the text, in place of the one derived from the HTML |
| `welcome.subject.hbs` | the subject, when the front matter gives none |
| `welcome.uk.hbs`, `welcome.uk.text.hbs`, … | the same in Ukrainian |

A locale is looked up with its subtags dropped one by one, then
`defaultLocale` the same way, then the template without a locale: `uk-UA` reads
`welcome.uk-UA.hbs`, `welcome.uk.hbs`, then `welcome.hbs`. The text and subject
are taken at the locale the HTML was found at, so that a Ukrainian body never
goes with an English subject. `variantName(template, { locale, part })` names
the variants another way.

A name with the extension of an engine (`welcome.hbs`) is that engine's alone;
without one, the engines are tried in their order.

## Front matter

A template may start with its subject and layout:

```hbs
---
subject: "Welcome, {{name}}"
layout: layouts/marketing
---
<p>…</p>
```

The subject is rendered with the template's engine and context, its entities
decoded and its whitespace collapsed. `layout: none` renders the template
without the renderer's `layout`. Any other key is an error, so a typo does not
pass unnoticed. `frontMatter: false` reads none.

## Layouts, partials and includes

`layout` names the layout of every HTML template; it is rendered with the
context and `body`, the HTML of the template, raw. A layout has no layout of
its own. Engines that have layouts of their own (Pug's `extends`, Nunjucks's
and Liquid's blocks, Handlebars partial blocks, Eta's `layout()`) keep them.

Every include, partial and layout an engine reads goes through the loader of
the renderer:

- `/x` is read from the root of the loader;
- `./x` and `../x` against the template it is written in (EJS: the template
  rendered, as EJS tells no more);
- any other name from the root, then from each directory of `partials`;
- the extensions of the engine are added when the name has none.

A name that leads out of the root is not found.

## Engines

::: v-pre

Each engine takes the module of its package; what the adapter sets itself (the
file name includes are read by, the cache, a file system) is refused as an
option rather than accepted and ignored.

| Engine | Made with | Extensions | Escapes by default |
| --- | --- | --- | --- |
| EJS | `createEjsEngine({ ejs: require('ejs'), options: { async } })` | `.ejs` | `<%= %>`; `<%- %>` is raw |
| Handlebars | `createHandlebarsEngine({ handlebars, helpers, configure })` | `.hbs`, `.handlebars` | `{{ }}`; `{{{ }}}` is raw |
| Pug | `createPugEngine({ pug, options: { doctype } })` | `.pug` | `#{}`, `=`; `!{}` is raw |
| MJML | `createMjmlEngine({ mjml2html: require('mjml'), engine })` | `.mjml`, or `.mjml` before the engine's | — |
| Liquid | `createLiquidEngine({ Liquid: require('liquidjs').Liquid, filters })` | `.liquid` | yes (`outputEscape: 'escape'`); `\| raw` |
| Nunjucks | `createNunjucksEngine({ nunjucks, filters, configure })` | `.njk`, `.nunjucks` | yes (`autoescape`) |
| Eta | `createEtaEngine({ Eta: require('eta').Eta, async })` | `.eta` | `<%= %>`; `<%~ %>` is raw |
| Mustache | `createMustacheEngine({ mustache, tags })` | `.mustache` | `{{ }}`; `{{{ }}}` is raw |
| React Email | `createReactEmailEngine({ render, createElement, components })` | — | JSX |

Several engines go into one renderer with `engines: [...]`, chosen by
extension, the longest first.

Some engines behave a little differently here than they do on their own:

- **Handlebars** gets an environment per renderer (`handlebars.create()`), so
  its helpers and partials stay out of the global one. The partials a template
  names are read when it is compiled. A dynamic partial (`{{> (name)}}`) has to
  be registered in `configure`.
- **Liquid** escapes output by default, where liquidjs escapes nothing unless
  told. It reads own properties only.
- **Mustache** fails on a partial that is not there, where it renders nothing.
  Its writer, and the cache of what it parsed, are per renderer and bounded.
- **MJML** renders after the engine inside it (`.mjml.hbs`), once the layout is
  applied, so the layout of an MJML template is MJML too. A static `.mjml` is
  rendered once. What MJML finds wrong under `validationLevel: 'soft'` goes to
  `onErrors`, or to a warning (`MAILER_TEMPLATE_MJML`); `'strict'` fails the
  render. `mj-include` reads files itself, unchecked, so it is off unless
  `includes: true`. Use the engine's partials instead.
- **React Email**: its templates are its components, by name (`welcome.uk` for
  a locale), each with its subject:

  ```js
  const engine = createReactEmailEngine({
    render: require('@react-email/render').render,
    createElement: require('react').createElement,
    components: {
      welcome: { component: Welcome, subject: ({ name }) => `Welcome, ${name}` },
    },
  });
  const templates = createTemplateRenderer({ engine });
  ```

Templates are code: EJS, Eta, Pug and Nunjucks run JavaScript or close to it.
For templates your tenants write, use Liquid (with `parseLimit`, `renderLimit`
and `memoryLimit`), Handlebars or Mustache. The context is data.

:::

## CSS

```js
const templates = createTemplateRenderer({
  engine,
  loader,
  inlineCss: createCssInliner({ inline: require('juice').default }),
  // or: createCssInliner({ inline: require('@css-inline/css-inline').inline })
});
```

The CSS is inlined after MJML and before the text is derived. The inliner is
given `{ loadRemoteStylesheets: false, keepLinkTags: true }` under your
options, so css-inline fetches no stylesheet on a send and keeps the `<link>`
of a web font for the mail clients that read it; juice fetches nothing itself.
css-inline drops `<style>` blocks, and with them `@media` queries, unless
`keepStyleTags: true`.

## Caching

Each template is read and compiled once, the least recently used of
`cache.maxEntries` (1000) dropped first; renders of a template not yet compiled
wait for the one compile. A template that is missing or fails is not kept, so
one deployed later is found. `clear()` forgets everything; `cache: false`
reads and compiles on every render, for development.

## Errors

| Thrown | When | `retryable` |
| --- | --- | --- |
| `TemplateNotFoundError` (`MAILER_TEMPLATE_NOT_FOUND`) | no template, include, partial or layout; `tried` lists the names looked up | `false` |
| `TemplateRenderError` (`MAILER_TEMPLATE_RENDER`) | syntax, a helper that threw, MJML under `strict`, the inliner; `phase`, `engine`, `cause` | `false` |
| `TypeError`, `RangeError` | a name that is not one, a bad locale or context | — |
| the loader's own error | the loader failed (`EMFILE`, a database timeout) | as classified |

The queue fails a job at once on the first three, and retries an outage of the
loader.

## Migrating from @nestjs-modules/mailer

| @nestjs-modules/mailer | @alexify/mailer/templates |
| --- | --- |
| `template: { dir, adapter }` | `createTemplateRenderer({ loader: createFileLoader({ dir }), engine })` |
| `new EjsAdapter()` | `createEjsEngine({ ejs })` |
| `new HandlebarsAdapter(helpers)` | `createHandlebarsEngine({ handlebars, helpers })` |
| `new PugAdapter()` | `createPugEngine({ pug })` |
| `new MjmlAdapter('handlebars')` | `createMjmlEngine({ mjml2html, engine: createHandlebarsEngine({ handlebars }) })` |
| `options.partials.dir` | `partials: ['partials']` |
| `inlineCssEnabled`, `inlineCssOptions` | `inlineCss: createCssInliner({ inline, options })` (off by default) |
| `template: path.resolve(dir, 'welcome')` | `template: 'welcome'`: a name, never a path |
| `subject` in the code of the sender | `subject` in the front matter, per locale |

What changes in behavior:

- a failed CSS inlining rejects once, where the callback was called twice;
- an async EJS template that throws rejects, where its promise rejected unheard
  and the send hung;
- the error of the engine inside MJML reaches you, a static MJML renders, and
  what MJML finds wrong is told;
- Handlebars helpers and partials stay in the renderer, and partials are read
  once, not on every send;
- Pug's locals are the context alone, never mixed with its options;
- no stylesheet is fetched on a send;
- every message has a text part.
