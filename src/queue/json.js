// Not ported: the data of a job as JSON, checked when it is enqueued: a
// value that JSON would turn into another (a Date into a string, a Map into
// `{}`, NaN into null) is refused with the path to it, so that a template does
// not meet in the worker what the producer did not give it.

const MAX_DEPTH = 32;

const kindOf = (value) => {
  if (value instanceof Date) return 'a Date; pass an ISO string';
  if (value instanceof Map || value instanceof Set) return `a ${value.constructor.name}`;
  return `an instance of ${value.constructor?.name ?? 'a class'}`;
};

const copyJson = (value, path, ancestors) => {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`${path} is ${value}, which JSON has not.`);
      return value;
    case 'object':
      break;
    default:
      throw new TypeError(`${path} is a ${typeof value}, which JSON has not.`);
  }
  if (value === null) return null;
  if (ancestors.has(value)) throw new TypeError(`${path} refers to itself.`);
  if (ancestors.size >= MAX_DEPTH) {
    throw new TypeError(`${path} is nested more than ${MAX_DEPTH} deep.`);
  }
  ancestors.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = [];
    for (let index = 0; index < value.length; index++) {
      if (value[index] === undefined) throw new TypeError(`${path}[${index}] is undefined.`);
      copy.push(copyJson(value[index], `${path}[${index}]`, ancestors));
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} is ${kindOf(value)}, which JSON has not.`);
    }
    copy = {};
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) copy[key] = copyJson(value[key], `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
  return copy;
};

/**
 * A copy of a value as JSON holds it, `undefined` in an object left out.
 *
 * @param value The value.
 * @param path Its name, for the message: `context`.
 * @returns The copy.
 * @throws {TypeError} If it holds what JSON has not: a function, a symbol, a
 * bigint, a number that is not finite, a Date, a Map or another class, a
 * cycle, or more than 32 levels.
 * @internal
 */
const toJson = (value, path) => copyJson(value, path, new Set());

module.exports = { toJson };
