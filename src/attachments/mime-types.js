// Ported from nodemailer v10.0.16 (src/mime-funcs/mime-types.ts): the types of
// the file extensions an email attachment commonly has, `detectMimeType` and
// `detectExtension`.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
// Changed in the port: about sixty extensions in place of some 2,000 lines, as
// the table is shipped to every bundle that reads an attachment from a path.

const DEFAULT_TYPE = 'application/octet-stream';

// The extension, its type; the first extension of a type is the one written
// for it.
const TYPES = [
  ['txt', 'text/plain'],
  ['text', 'text/plain'],
  ['log', 'text/plain'],
  ['htm', 'text/html'],
  ['html', 'text/html'],
  ['css', 'text/css'],
  ['csv', 'text/csv'],
  ['ics', 'text/calendar'],
  ['md', 'text/markdown'],
  ['vcf', 'text/vcard'],
  ['xml', 'application/xml'],
  ['json', 'application/json'],
  ['js', 'text/javascript'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['jpe', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['heic', 'image/heic'],
  ['svg', 'image/svg+xml'],
  ['bmp', 'image/bmp'],
  ['tif', 'image/tiff'],
  ['tiff', 'image/tiff'],
  ['ico', 'image/vnd.microsoft.icon'],
  ['pdf', 'application/pdf'],
  ['rtf', 'application/rtf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['ppt', 'application/vnd.ms-powerpoint'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['odt', 'application/vnd.oasis.opendocument.text'],
  ['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['odp', 'application/vnd.oasis.opendocument.presentation'],
  ['epub', 'application/epub+zip'],
  ['zip', 'application/zip'],
  ['gz', 'application/gzip'],
  ['tgz', 'application/gzip'],
  ['tar', 'application/x-tar'],
  ['7z', 'application/x-7z-compressed'],
  ['rar', 'application/vnd.rar'],
  ['eml', 'message/rfc822'],
  ['mp3', 'audio/mpeg'],
  ['m4a', 'audio/mp4'],
  ['wav', 'audio/wav'],
  ['ogg', 'audio/ogg'],
  ['mp4', 'video/mp4'],
  ['m4v', 'video/mp4'],
  ['mov', 'video/quicktime'],
  ['webm', 'video/webm'],
  ['avi', 'video/x-msvideo'],
  ['woff', 'font/woff'],
  ['woff2', 'font/woff2'],
  ['ttf', 'font/ttf'],
  ['otf', 'font/otf'],
  ['p7s', 'application/pkcs7-signature'],
  ['asc', 'application/pgp-signature'],
  ['pem', 'application/x-pem-file'],
  ['bin', DEFAULT_TYPE],
];

const TYPE_OF_EXTENSION = new Map();
const EXTENSION_OF_TYPE = new Map();
for (let i = 0; i < TYPES.length; i++) {
  const entry = TYPES[i];
  TYPE_OF_EXTENSION.set(entry[0], entry[1]);
  if (!EXTENSION_OF_TYPE.has(entry[1])) EXTENSION_OF_TYPE.set(entry[1], entry[0]);
}

/**
 * The media type of a file name by its extension.
 *
 * @param filename A file name or a path.
 * @returns The type, or `application/octet-stream` for an extension it does
 * not know.
 * @internal
 */
const typeOfFilename = (filename) => {
  const dot = filename.lastIndexOf('.');
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  if (dot <= slash + 1) return DEFAULT_TYPE;
  return TYPE_OF_EXTENSION.get(filename.slice(dot + 1).toLowerCase()) ?? DEFAULT_TYPE;
};

/**
 * The extension written for a media type.
 *
 * @param type A media type, without parameters.
 * @returns The extension, or `bin`.
 * @internal
 */
const extensionOfType = (type) => EXTENSION_OF_TYPE.get(type.toLowerCase()) ?? 'bin';

module.exports = { DEFAULT_TYPE, extensionOfType, typeOfFilename };
