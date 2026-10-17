// Not ported: the attachment object the helpers of ./attachments return, its
// fields checked when it is made rather than when the message is sent.

const { checkAttachment } = require('../core/message.js');

// RFC 6838 §4.2: a type and a subtype of restricted-name characters.
const MEDIA_TYPE = /^[A-Za-z0-9][\w!#$&^.+-]{0,126}\/[A-Za-z0-9][\w!#$&^.+-]{0,126}$/;

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

const hasControl = (text) => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

/**
 * The media type of a value, without its parameters, if it is one.
 *
 * @param value A `Content-Type` value or a media type.
 * @returns The type in lower case, or `undefined`.
 * @internal
 */
const mediaTypeOf = (value) => {
  if (typeof value !== 'string') return undefined;
  const end = value.indexOf(';');
  const type = (end === -1 ? value : value.slice(0, end)).trim().toLowerCase();
  return MEDIA_TYPE.test(type) ? type : undefined;
};

/**
 * Checks a positive whole number of bytes.
 *
 * @param value The option.
 * @returns The bound, `DEFAULT_MAX_BYTES` when it is not given.
 * @throws {TypeError} If it is not a positive whole number.
 * @internal
 */
const checkMaxBytes = (value) => {
  if (value === undefined) return DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`maxBytes must be a positive whole number: ${value}`);
  }
  return value;
};

/**
 * Makes an attachment of content and the options a helper was given.
 *
 * @param options `filename`, `contentType`, `contentId` and `inline`.
 * @param content The content.
 * @param defaults The `filename` and `contentType` the helper found.
 * @returns The attachment.
 * @throws {TypeError} If a field is invalid, or an inline attachment has no
 * content ID for the HTML to refer to.
 * @internal
 */
const createAttachment = (options, content, defaults) => {
  const filename = options.filename ?? defaults.filename;
  if (typeof filename !== 'string' || filename === '' || hasControl(filename)) {
    throw new TypeError(`Invalid attachment filename: ${JSON.stringify(filename)}`);
  }
  const contentType = options.contentType ?? defaults.contentType;
  if (typeof contentType !== 'string' || !MEDIA_TYPE.test(contentType)) {
    throw new TypeError(`Invalid attachment content type: ${JSON.stringify(contentType)}`);
  }
  const inline = options.inline ?? false;
  if (typeof inline !== 'boolean') throw new TypeError('inline must be a boolean.');
  const contentId = options.contentId ?? '';
  if (typeof contentId !== 'string' || hasControl(contentId) || /[\s<>]/.test(contentId)) {
    throw new TypeError(`Invalid attachment content ID: ${JSON.stringify(contentId)}`);
  }
  if (inline && contentId === '') {
    throw new TypeError('An inline attachment needs the contentId its HTML refers to as cid:.');
  }
  return checkAttachment({ inline, filename, content, contentType, contentId });
};

module.exports = { DEFAULT_MAX_BYTES, checkMaxBytes, createAttachment, mediaTypeOf };
