// Not ported: the checks of the options of the engines of ./templates.  An
// option an engine keeps for itself, such as the file name its includes are
// read by, is refused rather than accepted and never read.

/**
 * Checks the options passed on to an engine, and gives a copy of them.
 *
 * @param options The options, if any.
 * @param reserved The names the adapter sets itself.
 * @param engine The name of the engine, for the message.
 * @returns A plain copy, for the engine.
 * @throws {TypeError} If they are not an object or name a reserved option.
 * @internal
 */
const checkEngineOptions = (options, reserved, engine) => {
  if (options === undefined) return {};
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError(`The options of the ${engine} engine must be an object.`);
  }
  for (const name of Object.keys(options)) {
    if (reserved.has(name)) {
      throw new TypeError(
        `${name} is set by the ${engine} engine of ./templates, which reads templates ` +
          'through its loader.',
      );
    }
  }
  return { ...options };
};

/**
 * Checks the extensions of an engine.
 *
 * @internal
 */
const checkEngineExtensions = (extensions, defaults) => {
  if (extensions === undefined) return Object.freeze([...defaults]);
  if (!Array.isArray(extensions) || extensions.length === 0) {
    throw new TypeError('extensions must be a list such as [".hbs"].');
  }
  for (const extension of extensions) {
    if (typeof extension !== 'string' || extension.length < 2 || extension[0] !== '.') {
      throw new TypeError(`An extension starts with its dot, such as ".hbs": ${String(extension)}`);
    }
  }
  return Object.freeze([...extensions]);
};

/**
 * Checks a record of functions, such as helpers or filters.
 *
 * @internal
 */
const checkFunctions = (record, what) => {
  if (record === undefined) return {};
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new TypeError(`${what} must be an object of functions.`);
  }
  for (const name of Object.keys(record)) {
    if (typeof record[name] !== 'function') {
      throw new TypeError(`${what}.${name} must be a function.`);
    }
  }
  return record;
};

/**
 * Checks the module or class of an engine the application passes in.
 *
 * @internal
 */
const checkModule = (value, member, message) => {
  const ok =
    member === undefined ? typeof value === 'function' : typeof value?.[member] === 'function';
  if (!ok) throw new TypeError(message);
  return value;
};

module.exports = { checkEngineExtensions, checkEngineOptions, checkFunctions, checkModule };
