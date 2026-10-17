// Not ported: the messages of a sendMany() read as they are needed
// rather than all at once, so that it holds a batch in memory, not its input.

const noop = () => {};

/**
 * The items of an iterable, synchronous or not, through one async iterator
 * that can be read by hand and then iterated for the rest.
 *
 * @param iterable The items.
 * @returns An async generator of them.
 * @internal
 */
const readItems = async function* (iterable) {
  for await (const item of iterable) yield item;
};

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

/**
 * Sends the messages of an iterable with up to `limit` sends at a time,
 * reading a message only when a send can start, and gives the receipts in the
 * order of the messages.  With a limit of 1 a message is read and sent only
 * after the receipt of the one before was taken.
 *
 * @param messages The messages, synchronous or not.
 * @param limit The most sends at once.
 * @param send Sends one message and gives its receipt.
 * @param signal Checked before each send.
 * @returns The receipts, in order.
 * @internal
 */
const sendConcurrently = async function* (messages, limit, send, signal) {
  const iterator = readItems(messages);
  const pending = [];
  let head = 0;
  let done = false;
  try {
    while (true) {
      while (!done && pending.length - head < limit) {
        const item = await iterator.next();
        if (item.done) {
          done = true;
        } else {
          signal?.throwIfAborted();
          const sending = send(item.value);
          // A later send can fail while an earlier one is awaited: observed
          // here, its failure still reaches the caller when its turn comes.
          sending.catch(noop);
          pending.push(sending);
        }
      }
      if (head === pending.length) return;
      const receipt = await pending[head];
      pending[head++] = undefined;
      if (head === pending.length) {
        pending.length = 0;
        head = 0;
      }
      yield receipt;
    }
  } finally {
    await iterator.return();
  }
};

module.exports = { chunks, readItems, sendConcurrently };
