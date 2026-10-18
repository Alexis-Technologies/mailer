// Not ported: the entry of ./templates, templates by name rendered by an
// engine the application passes in.

const { createCssInliner } = require('./css.js');
const { createEjsEngine } = require('./ejs.js');
const { TemplateNotFoundError, TemplateRenderError } = require('./errors.js');
const { createEtaEngine } = require('./eta.js');
const { createHandlebarsEngine } = require('./handlebars.js');
const { createLiquidEngine } = require('./liquid.js');
const { createFileLoader, createMemoryLoader } = require('./loader.js');
const { createMjmlEngine } = require('./mjml.js');
const { createMustacheEngine } = require('./mustache.js');
const { createNunjucksEngine } = require('./nunjucks.js');
const { createPugEngine } = require('./pug.js');
const { createReactEmailEngine } = require('./react-email.js');
const { createTemplateRenderer } = require('./renderer.js');

module.exports = {
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
  TemplateNotFoundError,
  TemplateRenderError,
};
