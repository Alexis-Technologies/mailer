// Not ported: attachments read from a path, a URL, a data URI or a stream,
// after nodemailer's `path`, `href` and data URIs and sently's
// `resolveAttachments`, each a helper the application calls, so that nothing
// reads a file or a URL a message merely names.

const { fromDataUri, inlineDataUrls } = require('./data-uri.js');
const { fromPath } = require('./path.js');
const { fromStream } = require('./stream.js');
const { fromUrl, isPublicUrl } = require('./url.js');

module.exports = { fromDataUri, fromPath, fromStream, fromUrl, inlineDataUrls, isPublicUrl };
