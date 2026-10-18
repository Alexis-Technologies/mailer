// Not ported: where templates are read, by a name and never a path: from a
// directory, with nothing outside it read through `..` or a symbolic link, or
// from memory.  @nestjs-modules/mailer took a template as an absolute path,
// or joined `..` into its directory, and read whatever it led to.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { isWithin } = require('../internal/path.js');
const { checkPositiveInteger } = require('../internal/options.js');

const NAME = /^[A-Za-z0-9_@-][A-Za-z0-9_.@/-]*$/;
const MAX_NAME_LENGTH = 256;
const DEFAULT_MAX_BYTES = 1024 * 1024;

/**
 * Whether a value is a template name: `welcome`, `auth/reset-password`,
 * `welcome.uk.hbs`; letters, digits, `_`, `-`, `@`, `.` and `/` between
 * segments, none of them empty or starting with `.` (`..`, `.env`), at most
 * 256 characters.
 *
 * @internal
 */
const isTemplateName = (name) => {
  if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH || !NAME.test(name)) {
    return false;
  }
  let start = 0;
  for (;;) {
    const slash = name.indexOf('/', start);
    const segment = name.slice(start, slash === -1 ? name.length : slash);
    if (segment === '' || segment[0] === '.') return false;
    if (slash === -1) return true;
    start = slash + 1;
  }
};

/**
 * The error of a value that is no template name.
 *
 * @internal
 */
const notTemplateName = (name, what) =>
  new TypeError(
    `${what} must be a template name such as "welcome" or "auth/reset-password", ` +
      `not a path: ${JSON.stringify(name)}`,
  );

/**
 * Checks a template name.
 *
 * @throws {TypeError} If it is not one.
 * @internal
 */
const checkTemplateName = (name, what) => {
  if (!isTemplateName(name)) throw notTemplateName(name, what);
  return name;
};

const checkExtensions = (extensions, what) => {
  if (extensions === undefined) return undefined;
  if (!Array.isArray(extensions)) throw new TypeError(`${what} must be an array.`);
  const set = new Set();
  for (const extension of extensions) {
    if (typeof extension !== 'string' || extension.length < 2 || extension[0] !== '.') {
      throw new TypeError(`${what} holds extensions with their dot, such as ".hbs".`);
    }
    set.add(extension);
  }
  return set;
};

const hasExtension = (name, extensions) => {
  if (extensions === undefined) return true;
  for (const extension of extensions) {
    if (name.endsWith(extension)) return true;
  }
  return false;
};

const isMissing = (error) => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';

// A file is opened without following a link its last segment became after
// its real path was checked, where the system can say so.
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
const CHUNK = 64 * 1024;

// The reads of an open file of `size` bytes, up to `limit`, through the
// descriptor its size was taken from, so that a file that grew since is not
// read whole: each read yields where it goes and is given the bytes read, so
// that one loop serves a descriptor and a handle.
const readsOf = function* (size, limit) {
  let buffer = Buffer.allocUnsafe(Math.min(size + 1, limit));
  let total = 0;
  for (;;) {
    if (total === buffer.length) {
      if (total === limit) return buffer;
      const grown = Buffer.allocUnsafe(Math.min(total + CHUNK, limit));
      buffer.copy(grown, 0, 0, total);
      buffer = grown;
    }
    const bytesRead = yield { buffer, offset: total };
    if (bytesRead === 0) return buffer.subarray(0, total);
    total += bytesRead;
  }
};

const readAtMost = async (handle, size, limit) => {
  const reads = readsOf(size, limit);
  let step = reads.next();
  while (!step.done) {
    const into = step.value;
    const read = await handle.read(
      into.buffer,
      into.offset,
      into.buffer.length - into.offset,
      null,
    );
    step = reads.next(read.bytesRead);
  }
  return step.value;
};

const readAtMostSync = (fd, size, limit) => {
  const reads = readsOf(size, limit);
  let step = reads.next();
  while (!step.done) {
    const into = step.value;
    step = reads.next(
      fs.readSync(fd, into.buffer, into.offset, into.buffer.length - into.offset, null),
    );
  }
  return step.value;
};

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// A file opened as the real path of a name: none when it is gone or is a
// directory, which Windows does not open.
const isNoFile = (error) => isMissing(error) || error?.code === 'EISDIR';

/**
 * Makes a loader of the templates in a directory.
 *
 * @param options `dir`, `extensions` (any by default) and `maxBytes` (1 MiB).
 * @returns The loader: `load(name, { signal })`, which stops between its
 * reads when the signal aborts, and `loadSync(name)`.
 * @throws {TypeError} If an option is invalid.
 */
const createFileLoader = (options = {}) => {
  const { dir } = options;
  if (typeof dir !== 'string' || dir === '') {
    throw new TypeError('createFileLoader needs dir, the directory of the templates.');
  }
  const extensions = checkExtensions(options.extensions, 'extensions');
  const maxBytes = checkPositiveInteger(options.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes');
  // The root is resolved when it is first read, so that a loader can be made
  // before its directory exists, and then kept.
  let root;
  const checkWithin = (name, real) => {
    if (!isWithin(real, root)) {
      throw new RangeError(`The template ${JSON.stringify(name)} leads out of ${dir}.`);
    }
  };
  const tooLong = (name) =>
    new RangeError(`The template ${JSON.stringify(name)} holds more than ${maxBytes} bytes.`);
  const sourceOf = (name, real, bytes) => {
    if (bytes.length > maxBytes) throw tooLong(name);
    return { name, source: stripBom(bytes.toString('utf8')), path: real };
  };
  const accepts = (name) => isTemplateName(name) && hasExtension(name, extensions);
  return {
    async load(name, loadOptions) {
      if (!accepts(name)) return undefined;
      const signal = loadOptions?.signal;
      signal?.throwIfAborted();
      root ??= await fsp.realpath(dir);
      let real;
      try {
        real = await fsp.realpath(path.join(root, name));
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
      checkWithin(name, real);
      signal?.throwIfAborted();
      let handle;
      try {
        handle = await fsp.open(real, OPEN_FLAGS);
      } catch (error) {
        if (isNoFile(error)) return undefined;
        throw error;
      }
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) return undefined;
        if (stats.size > maxBytes) throw tooLong(name);
        return sourceOf(name, real, await readAtMost(handle, stats.size, maxBytes + 1));
      } finally {
        await handle.close();
      }
    },
    loadSync(name) {
      if (!accepts(name)) return undefined;
      root ??= fs.realpathSync(dir);
      let real;
      try {
        real = fs.realpathSync(path.join(root, name));
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
      checkWithin(name, real);
      let fd;
      try {
        fd = fs.openSync(real, OPEN_FLAGS);
      } catch (error) {
        if (isNoFile(error)) return undefined;
        throw error;
      }
      try {
        const stats = fs.fstatSync(fd);
        if (!stats.isFile()) return undefined;
        if (stats.size > maxBytes) throw tooLong(name);
        return sourceOf(name, real, readAtMostSync(fd, stats.size, maxBytes + 1));
      } finally {
        fs.closeSync(fd);
      }
    },
  };
};

/**
 * Makes a loader of templates held in memory, by name.
 *
 * @param templates The templates by name: their sources, or what an engine
 * takes, such as React components.
 * @returns The loader.
 * @throws {TypeError} If it is not an object or a key is not a template name.
 */
const createMemoryLoader = (templates) => {
  if (typeof templates !== 'object' || templates === null || Array.isArray(templates)) {
    throw new TypeError('createMemoryLoader needs the templates by name.');
  }
  const sources = new Map();
  for (const name of Object.keys(templates)) {
    checkTemplateName(name, 'A key of the memory loader');
    sources.set(name, templates[name]);
  }
  const loadSync = (name) => (sources.has(name) ? { name, source: sources.get(name) } : undefined);
  return { load: loadSync, loadSync };
};

module.exports = {
  checkTemplateName,
  createFileLoader,
  createMemoryLoader,
  isTemplateName,
  notTemplateName,
};
