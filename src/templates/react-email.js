// Not ported: React Email as an engine of ./templates: its templates are
// components by name, rendered by the renderer of ./render with the
// `render` and `createElement` the application passes in, so the package
// depends on neither React nor React Email.

const { createReactEmailRenderer } = require('../render/react-email.js');
const { createMemoryLoader } = require('./loader.js');

const entryOf = (name, value) => {
  if (typeof value === 'function') return { component: value };
  if (typeof value?.component !== 'function') {
    throw new TypeError(`The React Email template ${name} must be a component or { component }.`);
  }
  const { subject } = value;
  if (subject !== undefined && typeof subject !== 'string' && typeof subject !== 'function') {
    throw new TypeError(`The subject of ${name} must be a string or a function of its props.`);
  }
  return { component: value.component, subject };
};

/**
 * Makes the React Email engine: its templates are its components.
 *
 * @param options `render`, that of `@react-email/render`; `createElement`,
 * `React.createElement`; `components` by template name (`welcome.uk` for a
 * locale), each a component or `{ component, subject }`; `plainText` (true)
 * and `renderOptions`, as `createReactEmailRenderer` takes them.
 * @returns The engine, with a loader of its components.
 * @throws {TypeError} If an option is invalid.
 */
const createReactEmailEngine = (options = {}) => {
  const renderer = createReactEmailRenderer(options);
  const { createElement, components } = options;
  if (typeof createElement !== 'function') {
    throw new TypeError('createReactEmailEngine needs createElement: React.createElement.');
  }
  if (typeof components !== 'object' || components === null || Array.isArray(components)) {
    throw new TypeError('createReactEmailEngine needs its components by template name.');
  }
  const entries = Object.create(null);
  for (const name of Object.keys(components)) entries[name] = entryOf(name, components[name]);
  return {
    name: 'react-email',
    extensions: [],
    // Its HTML, text and subject at once: a renderer with a layout refuses it.
    parts: true,
    loader: createMemoryLoader(entries),
    compile(entry, context) {
      if (context.part !== 'html') {
        throw new TypeError(
          `${context.name}: a React Email template gives its text and subject itself.`,
        );
      }
      return async (scope) => {
        const { html, text } = await renderer.render(createElement(entry.component, scope));
        const subject = typeof entry.subject === 'function' ? entry.subject(scope) : entry.subject;
        return subject === undefined ? { html, text } : { html, text, subject };
      };
    },
  };
};

module.exports = { createReactEmailEngine };
