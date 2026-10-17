// Ported from sently v1.2.2 (src/transports/resolve-attachments.ts): an
// attachment read from a file, kept within a directory when one is given.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Also ported from nodemailer v10.0.16 (src/mail-composer/index.ts): the file
// name and the type of an attachment by its path.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
// Changed in the port: the path and the root are resolved with realpath, so a
// symbolic link cannot lead out of the root, which sently compared as written;
// the file is read again for each reading rather than held in memory; and no
// `path` of an attachment is read but through this helper, where nodemailer
// read any it was given.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createAttachment } = require('./attachment.js');
const { typeOfFilename } = require('./mime-types.js');

// Whether a resolved path is the directory or under it; a name such as
// `..data` under it is, `../data` is not.
const isWithin = (file, directory) => {
  const relative = path.relative(directory, file);
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
};

// Opens the file for each reading, so the content can be read again (for
// DKIM, a retry, another transport of a pool) without holding it.
const readFile = (file) =>
  async function* (signal) {
    yield* fs.createReadStream(file, { signal });
  };

/**
 * Makes an attachment of a file, read when the message is sent.
 *
 * @param filePath The path of the file.
 * @param options The `root` the file must be in, and the fields of the
 * attachment: by default its file name and the type of its extension.
 * @returns The attachment.
 * @throws {Error} If the file does not exist or cannot be resolved.
 * @throws {RangeError} If it is outside `root`.
 * @throws {TypeError} If it is not a regular file, or a field is invalid.
 */
const fromPath = async (filePath, options = {}) => {
  if (typeof filePath !== 'string' || filePath === '') {
    throw new TypeError('fromPath() needs the path of a file.');
  }
  const file = await fsp.realpath(filePath);
  if (options.root != null) {
    const root = await fsp.realpath(options.root);
    if (!isWithin(file, root)) {
      throw new RangeError(
        `${JSON.stringify(filePath)} is outside ${JSON.stringify(options.root)}.`,
      );
    }
  }
  const stats = await fsp.stat(file);
  if (!stats.isFile()) throw new TypeError(`${JSON.stringify(filePath)} is not a file.`);
  const filename = path.basename(filePath);
  return createAttachment(options, readFile(file), {
    filename,
    contentType: typeOfFilename(options.filename ?? filename),
  });
};

module.exports = { fromPath };
