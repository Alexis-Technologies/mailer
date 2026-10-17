// Not ported: `sendMany()` of a decorator that answers some messages itself (a
// refusal, a stored receipt) and hands the others to the transport it wraps,
// through that transport's own `sendMany()` so its batching is kept, with the
// receipts in the order of the messages.

/**
 * A first-in first-out queue whose `shift` takes constant time.
 *
 * @internal
 */
class Fifo {
  #items = [];
  #head = 0;

  get size() {
    return this.#items.length - this.#head;
  }

  push(item) {
    this.#items.push(item);
  }

  shift() {
    const item = this.#items[this.#head];
    this.#items[this.#head] = undefined;
    this.#head++;
    // The consumed half is dropped once it is the larger part.
    if (this.#head > 1024 && this.#head * 2 > this.#items.length) {
      this.#items = this.#items.slice(this.#head);
      this.#head = 0;
    }
    return item;
  }
}

const iteratorOf = (messages) =>
  typeof messages[Symbol.asyncIterator] === 'function'
    ? messages[Symbol.asyncIterator]()
    : messages[Symbol.iterator]();

/**
 * Sends messages through a gate.  `gate.admit(message)` decides each one: `{
 * receipt }` answers it in place; `{ message, …state }` hands `message` to the
 * wrapped transport.  The admitted ones go through `transport.sendMany()` in
 * runs, a run ending at a message answered in place, and each receipt goes
 * through `gate.settle(receipt, admitted)` before it is yielded.  When the
 * wrapped `sendMany()` throws, `gate.fail(error, admitted)` hears of each
 * message still waiting for its receipt.
 *
 * @param transport The wrapped transport.
 * @param messages The messages, sync or async.
 * @param options The caller's options, passed on.
 * @param gate `admit`, and optional `settle` and `fail`.
 * @returns The receipts, one per message, in order.
 * @internal
 */
const gatedSendMany = async function* (transport, messages, options, gate) {
  options?.signal?.throwIfAborted();
  const iterator = iteratorOf(messages);
  let first;
  try {
    for (;;) {
      if (first === undefined) {
        const step = await iterator.next();
        if (step.done) return;
        const decision = await gate.admit(step.value);
        if (decision.receipt !== undefined) {
          yield decision.receipt;
          continue;
        }
        first = decision;
      }
      const run = { iterator, first, fed: new Fifo(), refusal: undefined, exhausted: false };
      first = undefined;
      yield* sendRun(transport, run, options, gate);
      if (run.refusal !== undefined) yield run.refusal;
      if (run.exhausted) return;
    }
  } finally {
    await iterator.return?.();
  }
};

// The admitted messages of a run, read until one is answered in place or the
// input ends.
const feedRun = async function* (run, gate) {
  run.fed.push(run.first);
  yield run.first.message;
  for (;;) {
    const step = await run.iterator.next();
    if (step.done) {
      run.exhausted = true;
      return;
    }
    const decision = await gate.admit(step.value);
    if (decision.receipt !== undefined) {
      run.refusal = decision.receipt;
      return;
    }
    run.fed.push(decision);
    yield decision.message;
  }
};

const sendRun = async function* (transport, run, options, gate) {
  try {
    for await (const receipt of transport.sendMany(feedRun(run, gate), options)) {
      const admitted = run.fed.shift();
      yield gate.settle === undefined ? receipt : await gate.settle(receipt, admitted);
    }
  } catch (error) {
    if (gate.fail !== undefined) {
      while (run.fed.size > 0) await gate.fail(error, run.fed.shift());
    }
    throw error;
  }
};

module.exports = { Fifo, gatedSendMany };
