// Ported from nodemailer v10.0.16 (src/shared/index.ts): `parseDataURI`, an
// attachment of a data URI (RFC 2397).
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
// Also ported from nodemailer v10.0.16 (src/mailer/index.ts): `_convertDataImages`,
// the data URIs of the images of HTML as inline attachments (`attachDataUrls`).
// Changed in the port: a data URI over `maxBytes`, or one that does not parse,
// is refused, where nodemailer gave an empty attachment or read the URI as a
// file path; base64 is checked rather than decoded leniently; percent-encoded
// bytes are bytes, not UTF-8 text; and a URI without a type is text/plain, as
// RFC 2397 says.

const { Buffer } = require('node:buffer');
const { generateId } = require('../core/id.js');
const { isDotAtomText } = require('../core/text.js');
const { checkMaxBytes, createAttachment, mediaTypeOf } = require('./attachment.js');
const { extensionOfType } = require('./mime-types.js');

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const ASCII_WHITESPACE = /[\t\n\f\r ]+/g;
const HEX = /^[0-9A-Fa-f]{2}$/;

const invalid = (uri) =>
  new TypeError(`Invalid data URI: ${JSON.stringify(String(uri).slice(0, 64))}`);

const decodeBase64 = (uri, data, maxBytes) => {
  const text = data.replace(ASCII_WHITESPACE, '');
  if (!BASE64.test(text) || text.length % 4 === 1) throw invalid(uri);
  if (Math.floor((text.length * 3) / 4) > maxBytes) {
    throw new RangeError(`The data URI holds more than ${maxBytes} bytes.`);
  }
  return new Uint8Array(Buffer.from(text, 'base64'));
};

// RFC 2397 data is a URL-encoded string of octets: `%XX` is a byte, and any
// other character stands for its UTF-8 bytes.
const decodePercent = (uri, data, maxBytes) => {
  const bytes = [];
  let text = '';
  const flush = () => {
    if (text === '') return;
    const encoded = Buffer.from(text, 'utf8');
    for (let i = 0; i < encoded.length; i++) bytes.push(encoded[i]);
    text = '';
  };
  for (let i = 0; i < data.length; i++) {
    if (data.charCodeAt(i) !== 0x25) {
      text += data[i];
      continue;
    }
    const hex = data.slice(i + 1, i + 3);
    if (!HEX.test(hex)) throw invalid(uri);
    flush();
    bytes.push(Number.parseInt(hex, 16));
    i += 2;
  }
  flush();
  if (bytes.length > maxBytes) {
    throw new RangeError(`The data URI holds more than ${maxBytes} bytes.`);
  }
  return Uint8Array.from(bytes);
};

/**
 * Makes an attachment of a data URI.
 *
 * @param uri A `data:` URI, base64 or percent-encoded.
 * @param options `maxBytes` (25 MiB), and the fields of the attachment: by
 * default the type of the URI and `attachment.<extension>`.
 * @returns The attachment, its content in memory.
 * @throws {TypeError} If the URI does not parse, or a field is invalid.
 * @throws {RangeError} If it holds more than `maxBytes`.
 */
const fromDataUri = (uri, options = {}) => {
  const maxBytes = checkMaxBytes(options.maxBytes);
  if (typeof uri !== 'string' || !/^data:/i.test(uri)) throw invalid(uri);
  const comma = uri.indexOf(',');
  if (comma === -1) throw invalid(uri);
  const meta = uri.slice(5, comma);
  const isBase64 = /;base64$/i.test(meta);
  const typeEnd = meta.indexOf(';');
  const declared = (typeEnd === -1 ? meta : meta.slice(0, typeEnd)).trim();
  const type = declared === '' ? 'text/plain' : mediaTypeOf(declared);
  if (type === undefined) throw invalid(uri);
  const data = uri.slice(comma + 1);
  const content = isBase64 ? decodeBase64(uri, data, maxBytes) : decodePercent(uri, data, maxBytes);
  return createAttachment(options, content, {
    filename: `attachment.${extensionOfType(type)}`,
    contentType: type,
  });
};

// nodemailer's pattern, bounded so that no input makes it backtrack long: an
// <img> whose src is a data URI with a parameter (`;base64`).
const DATA_IMAGE = /(<img\b[^<>]{0,1024} src\s{0,20}=[\s"']{0,20})(data:([^;]+);[^"'>\s]+)/gi;

/**
 * Turns the images of HTML given as data URIs into inline attachments, each
 * referred to by its Content-ID, which most clients show where they block
 * data URIs.
 *
 * @param html The HTML.
 * @param options `maxBytes` of one image (25 MiB), `generateId` for the left
 * half of each Content-ID and `domain` for its right half (`localhost`).
 * @returns The HTML with `cid:` URLs, and the attachments to send with it.
 * @throws {TypeError} If an image's data URI does not parse.
 * @throws {RangeError} If an image holds more than `maxBytes`.
 */
const inlineDataUrls = (html, options = {}) => {
  if (typeof html !== 'string') throw new TypeError('inlineDataUrls() needs HTML.');
  const domain = options.domain ?? 'localhost';
  if (typeof domain !== 'string' || !isDotAtomText(domain)) {
    throw new TypeError(`Invalid Content-ID domain: ${JSON.stringify(domain)}`);
  }
  const attachments = [];
  const replaced = html.replace(DATA_IMAGE, (match, prefix, uri, declared) => {
    const contentId = `${generateId('content-id', options.generateId)}@${domain}`;
    const type = mediaTypeOf(declared) ?? 'application/octet-stream';
    attachments.push(
      fromDataUri(uri, {
        maxBytes: options.maxBytes,
        inline: true,
        contentId,
        filename: `image-${attachments.length + 1}.${extensionOfType(type)}`,
      }),
    );
    return `${prefix}cid:${contentId}`;
  });
  return { html: replaced, attachments };
};

module.exports = { fromDataUri, inlineDataUrls };
