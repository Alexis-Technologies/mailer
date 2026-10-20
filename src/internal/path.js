// Not ported: whether a file is inside a directory, for ./attachments and the
// file loader of ./templates, which read nothing outside the root they are
// given.

const path = require('node:path');

/**
 * Whether a resolved path is the directory or under it; a name such as
 * `..data` under it is, `../data` is not.
 *
 * @param file The resolved path of the file.
 * @param directory The resolved path of the directory.
 * @returns `true` when the file is within the directory.
 * @internal
 */
const isWithin = (file, directory) => {
  const relative = path.relative(directory, file);
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
};

module.exports = { isWithin };
