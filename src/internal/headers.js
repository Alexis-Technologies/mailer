// Not ported: small helpers of header names that the converters of
// the HTTP providers share.

/**
 * The names, in lower case, as a set built in one pass.
 *
 * @param names Header names, such as the keys of a Map.
 * @returns A set of the lower-case names.
 * @internal
 */
const lowerCaseNames = (names) => {
  const set = new Set();
  for (const name of names) set.add(name.toLowerCase());
  return set;
};

module.exports = { lowerCaseNames };
