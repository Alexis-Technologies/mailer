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

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Makes a loader of the templates in a directory.
 *
 * @param options `dir`, `extensions` (any by default) and `maxBytes` (1 MiB).
 * @returns The loader.
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
  const checkStats = (name, stats) => {
    if (!stats.isFile()) return false;
    if (stats.size > maxBytes) {
      throw new RangeError(
        `The template ${JSON.stringify(name)} holds more than ${maxBytes} bytes.`,
      );
    }
    return true;
  };
  const accepts = (name) => isTemplateName(name) && hasExtension(name, extensions);
  return {
    async load(name) {
      if (!accepts(name)) return undefined;
      root ??= await fsp.realpath(dir);
      let real;
      try {
        real = await fsp.realpath(path.join(root, name));
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
      checkWithin(name, real);
      if (!checkStats(name, await fsp.stat(real))) return undefined;
      return { name, source: stripBom(await fsp.readFile(real, 'utf8')), path: real };
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
      if (!checkStats(name, fs.statSync(real))) return undefined;
      return { name, source: stripBom(fs.readFileSync(real, 'utf8')), path: real };
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
