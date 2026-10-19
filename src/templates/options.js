// Not ported: the checks of the options of the engines of ./templates.  An
// option an engine keeps for itself, such as the file name its includes are
// read by, is refused rather than accepted and never read.

const { checkExtensions } = require('./environment.js');

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
 * Refuses the options that turn off the escaping of an engine's output, or
 * put an escaper of the application's in its place, unless the engine is
 * given `allowUnescaped: true`: a template whose context a user wrote would
 * otherwise put that user's HTML into the message.
 *
 * @param options The options of the engine.
 * @param given The options passed on to the engine.
 * @param switches By the name of each such option, whether a value turns the
 * escaping off.
 * @param engine The name of the engine, for the message.
 * @throws {TypeError} If one is given without `allowUnescaped`.
 * @internal
 */
const checkEscaping = (options, given, switches, engine) => {
  const allowed = options.allowUnescaped ?? false;
  if (typeof allowed !== 'boolean') throw new TypeError('allowUnescaped must be a boolean.');
  if (allowed) return;
  for (const name of Object.keys(given)) {
    const turnsOff = switches.get(name);
    if (turnsOff !== undefined && turnsOff(given[name])) {
      throw new TypeError(
        `${name} turns off the escaping of the ${engine} engine: pass it allowUnescaped: true ` +
          'to allow that.',
      );
    }
  }
};

/**
 * Checks the extensions of an engine.
 *
 * @internal
 */
const checkEngineExtensions = (extensions, defaults) => {
  if (extensions === undefined) return Object.freeze([...defaults]);
  const checked = checkExtensions(extensions, 'extensions');
  if (checked.length === 0) throw new TypeError('extensions must name one at least.');
  return checked;
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

module.exports = {
  checkEngineExtensions,
  checkEngineOptions,
  checkEscaping,
  checkFunctions,
  checkModule,
};
