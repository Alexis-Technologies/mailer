// Not ported: the entry of ./render, the content of a message from a template.

const { htmlToText } = require('./html-to-text.js');
const { createReactEmailRenderer } = require('./react-email.js');
const { renderContent, renderFields } = require('./renderer.js');

module.exports = { createReactEmailRenderer, htmlToText, renderContent, renderFields };
