// Ported from sently v1.2.2 (src/transports/resolve-attachments.ts): an
// attachment read from a file, kept within a directory when one is given.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Also ported from nodemailer v10.0.16 (src/mail-composer/index.ts): the file
// name and the type of an attachment by its path.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
// Changed in the port: the path and the root are resolved with realpath, so a
// symbolic link cannot lead out of the root, which sently compared as written;
// the file is read again for each reading rather than held in memory, and it
// must still be the file that was checked, within `maxBytes`; and no `path` of
// an attachment is read but through this helper, where nodemailer read any it
// was given.

const fsp = require('node:fs/promises');
const path = require('node:path');
const { checkMaxBytes, createAttachment } = require('./attachment.js');
const { typeOfFilename } = require('./mime-types.js');

// Whether a resolved path is the directory or under it; a name such as
// `..data` under it is, `../data` is not.
const isWithin = (file, directory) => {
  const relative = path.relative(directory, file);
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
};

const tooLong = (filePath, maxBytes) =>
  new RangeError(`${JSON.stringify(filePath)} holds more than ${maxBytes} bytes.`);

// Opens the file for each reading, so the content can be read again (for
// DKIM, a retry, another transport of a pool) without holding it.  A reading
// may come long after the check, when the message leaves a queue: what is
// opened must be the file that was checked, not one a link or a renamed
// directory put in its place, and it must not have outgrown `maxBytes`.
const readFile = (file, filePath, checked, maxBytes) =>
  async function* (signal) {
    const handle = await fsp.open(file, 'r');
    try {
      const stats = await handle.stat();
      if (stats.dev !== checked.dev || stats.ino !== checked.ino) {
        throw new RangeError(`${JSON.stringify(filePath)} is no longer the file it was.`);
      }
      let size = 0;
      for await (const chunk of handle.createReadStream({ signal, autoClose: false })) {
        size += chunk.length;
        if (size > maxBytes) throw tooLong(filePath, maxBytes);
        yield chunk;
      }
    } finally {
      await handle.close();
    }
  };

/**
 * Makes an attachment of a file, read when the message is sent.
 *
 * @param filePath The path of the file.
 * @param options The `root` the file must be in, `maxBytes` (25 MiB), and the
 * fields of the attachment: by default its file name and the type of its
 * extension.
 * @returns The attachment.
 * @throws {Error} If the file does not exist or cannot be resolved.
 * @throws {RangeError} If it is outside `root`, or holds more than `maxBytes`.
 * @throws {TypeError} If it is not a regular file, or a field is invalid.
 */
const fromPath = async (filePath, options = {}) => {
  if (typeof filePath !== 'string' || filePath === '') {
    throw new TypeError('fromPath() needs the path of a file.');
  }
  const maxBytes = checkMaxBytes(options.maxBytes);
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
  if (stats.size > maxBytes) throw tooLong(filePath, maxBytes);
  const filename = path.basename(filePath);
  return createAttachment(options, readFile(file, filePath, stats, maxBytes), {
    filename,
    contentType: typeOfFilename(options.filename ?? filename),
  });
};

module.exports = { fromPath };
