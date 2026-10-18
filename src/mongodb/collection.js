// Not ported: what the stores of ./mongodb share in reading a collection of
// the MongoDB driver the application passes in, typed by the members they
// call, so the package depends on no version of it.

const METHODS = [
  'updateOne',
  'updateMany',
  'findOne',
  'findOneAndUpdate',
  'deleteOne',
  'find',
  'createIndex',
];

/**
 * Checks a collection of the MongoDB driver: `db.collection(name)`.
 *
 * @param collection The collection.
 * @param what What needs it, for the message.
 * @param methods The methods it calls.
 * @returns The collection.
 * @throws {TypeError} If it lacks one.
 * @internal
 */
const checkCollection = (collection, what, methods = METHODS) => {
  for (const method of methods) {
    if (typeof collection?.[method] !== 'function') {
      throw new TypeError(`${what} needs a collection of the MongoDB driver, with ${method}().`);
    }
  }
  return collection;
};

/**
 * Whether an error is MongoDB's duplicate key (E11000).
 *
 * @internal
 */
const isDuplicateKey = (error) => error?.code === 11000 || error?.code === 11001;

/**
 * The document `findOneAndUpdate` gave: the driver from 5.7 gives it as it
 * is with `includeResultMetadata: false`, an older one in `{ value }`.
 *
 * @internal
 */
const documentOf = (result) => {
  if (result !== null && typeof result === 'object' && 'ok' in result && 'value' in result) {
    return result.value;
  }
  return result ?? null;
};

/**
 * The options of a call in a transaction, when there is one.
 *
 * @internal
 */
const sessionOf = (transaction, options = {}) =>
  transaction === undefined || transaction === null
    ? options
    : { ...options, session: transaction };

module.exports = { checkCollection, documentOf, isDuplicateKey, sessionOf };
