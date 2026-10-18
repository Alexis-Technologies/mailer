// Not ported: the messages of a sendMany() read as they are needed, whatever
// the input, synchronous or not: by hand through its own iterator (a gate, a
// retry), or as an async generator a batch iterates for the rest.

/**
 * The items of an iterable, synchronous or not, through one async iterator
 * that can be read by hand and then iterated for the rest; its `return()`
 * closes the iterable.
 *
 * @param iterable The items.
 * @returns An async generator of them.
 * @internal
 */
const readItems = async function* (iterable) {
  for await (const item of iterable) yield item;
};

/**
 * The iterator of an iterable, synchronous or not, as it is: one whose
 * `return()` reaches the input at once, even while a `next()` is pending,
 * which a generator would hold behind it.  `await` takes either kind.
 *
 * @param values The items.
 * @returns Their iterator.
 * @internal
 */
const iteratorOf = (values) =>
  typeof values[Symbol.asyncIterator] === 'function'
    ? values[Symbol.asyncIterator]()
    : values[Symbol.iterator]();

module.exports = { iteratorOf, readItems };
