# Rendering templates

`@alexify/mailer/render` turns a template into the content of a message: React
Email components, or any template language behind a `render` function. It
comes from the renderers of unemail and the React plugin of sently. The package
has no template engine of its own and depends on neither React nor React Email:
the application passes in what renders.

## React Email

```js
const { render } = require('@react-email/render');
const { createMessage } = require('@alexify/mailer');
const { createReactEmailRenderer, renderContent } = require('@alexify/mailer/render');
const { Welcome } = require('./emails/welcome');

const reactEmail = createReactEmailRenderer({ render });

const message = createMessage({
  from: 'shop@example.com',
  to: user.email,
  subject: 'Welcome',
  content: await renderContent(reactEmail, Welcome({ name: user.name })),
});
```

`renderContent` gives `{ html, text }`, what `createMessage` takes as `content`.
The renderer renders the element twice: once to HTML, once with React Email's
own plain-text pass, which leaves out images and the preview text.
`plainText: false` renders it once and derives the text from the HTML instead;
`renderOptions` go to `render`, such as `{ pretty: true }`. A pass that fails
fails the render.

## A renderer of your own

A renderer is an object with `render(input)`, sync or async, which gives
`{ html }`, `{ text }` or both:

```js
const { marked } = require('marked');

const markdown = { render: (source) => ({ html: marked.parse(source) }) };

const content = await renderContent(markdown, '# Hello\n\nYour order has shipped.');
// { html: '<h1>Hello</h1>\n<p>Your order has shipped.</p>\n',
//   text: 'Hello\n\nYour order has shipped.' }
```

When a renderer gives HTML without text, `renderContent` derives the text with
`htmlToText`; `{ autoText: false }` leaves it without one.

## The subject

A renderer may give the subject of the message with its content, as the
templates of [`./templates`](/messages/templates) do from their front matter.
`renderContent` leaves it out; `renderFields` gives `{ subject, content }`, the
content rendered as `renderContent` renders it:

```js
const { renderFields } = require('@alexify/mailer/render');

const { subject, content } = await renderFields(templates, {
  template: 'welcome',
  context: { name: user.name },
});
const message = createMessage({ from: 'shop@example.com', to: user.email, subject, content });
```

`subject` is undefined when the renderer gives none; a subject that is not a
string fails the render.

## htmlToText

`htmlToText(html)` gives the plain text an HTML body reads as, for the text
alternative a message should carry:

- the text of the elements, its whitespace collapsed as a browser shows it,
  but in `pre`;
- a line for a block such as `div` or a table cell, a blank line for a
  paragraph, a heading or a list; `- ` or `1. ` before a list item;
- the address of a link after its label, or alone when the label is empty or
  the address itself;
- the character references decoded, an invalid number as U+FFFD.

Scripts, styles, the `head`, comments, the doctype and elements marked
`data-skip-in-text="true"` (React Email's preview text) are left out. It is not
a DOM parser: it handles what a mail body holds, in one pass, in time linear in
its length. Set `text` yourself when fidelity matters.

```js
htmlToText('<p>Hi <a href="https://example.com/start">there</a></p><ul><li>one</li></ul>');
// 'Hi there (https://example.com/start)\n\n- one'
```
