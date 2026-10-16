// Not ported from upyo: a batch of messages read as it is needed rather than
// all at once, so that a sendMany() holds one batch in memory, not its input.

/**
 * Reads an iterable, synchronous or not, in arrays of at most `size` items,
 * one array at a time.
 *
 * @param iterable The items.
 * @param size The most items an array holds.
 * @returns The arrays, none of them empty.
 * @internal
 */
const chunks = async function* (iterable, size) {
  let chunk = [];
  for await (const item of iterable) {
    chunk.push(item);
    if (chunk.length === size) {
      yield chunk;
      chunk = [];
    }
  }
  if (chunk.length > 0) yield chunk;
};

module.exports = { chunks };
