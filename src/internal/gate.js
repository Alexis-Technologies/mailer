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

  peek() {
    return this.#items[this.#head];
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

// The most answers in place a run holds while a message handed to the
// wrapped transport waits for its receipt: past it, the run ends, so that a
// long streak of them, a circuit open over an endless input, is not read
// ahead without bound.
const MAX_IN_PLACE = 64;

/**
 * Sends messages through a gate.  `gate.admit(message)` decides each one: `{
 * receipt }` answers it in place; `{ message, …state }` hands `message` to the
 * wrapped transport.  The admitted ones go through one `transport.sendMany()`,
 * the answers in place taking their turn among its receipts, so that a
 * transport that batches keeps its batches; a run ends only at the end of the
 * input or past `MAX_IN_PLACE` answers in place in a row.  Each receipt goes
 * through `gate.settle(receipt, admitted)` before it is yielded.  When the
 * wrapped `sendMany()` throws, `gate.fail(error, admitted)` hears of each
 * message still waiting for its receipt; when the caller stops reading, or
 * the wrapped `sendMany()` ends short, `gate.abandon(admitted)` does, as a
 * transport that reads ahead may have sent them or not.
 *
 * @param transport The wrapped transport.
 * @param messages The messages, sync or async.
 * @param options The caller's options, passed on.
 * @param gate `admit`, and optional `settle`, `fail` and `abandon`.
 * @returns The receipts, one per message, in order.
 * @internal
 */
const gatedSendMany = async function* (transport, messages, options, gate) {
  options?.signal?.throwIfAborted();
  const iterator = iteratorOf(messages);
  try {
    for (;;) {
      // Until a message goes to the transport, the answers in place go at once.
      const step = await iterator.next();
      if (step.done) return;
      const decision = await gate.admit(step.value);
      if (decision.receipt !== undefined) {
        yield decision.receipt;
        continue;
      }
      // In the order of the messages: `{ admitted }` waiting for its receipt,
      // or `{ receipt }` answered in place.
      const run = { iterator, first: decision, slots: new Fifo(), inPlace: 0, exhausted: false };
      yield* sendRun(transport, run, options, gate);
      while (run.slots.size > 0) yield run.slots.shift().receipt;
      if (run.exhausted) return;
    }
  } finally {
    await iterator.return?.();
  }
};

// The admitted messages of a run, read until the input ends or too many
// answers in place wait.
const feedRun = async function* (run, gate) {
  run.slots.push({ admitted: run.first });
  yield run.first.message;
  for (;;) {
    if (run.inPlace >= MAX_IN_PLACE) return;
    const step = await run.iterator.next();
    if (step.done) {
      run.exhausted = true;
      return;
    }
    const decision = await gate.admit(step.value);
    if (decision.receipt !== undefined) {
      run.slots.push({ receipt: decision.receipt });
      run.inPlace++;
      continue;
    }
    run.slots.push({ admitted: decision });
    yield decision.message;
  }
};

// The messages of a run still waiting for their receipts, to be failed or
// abandoned; the answers in place among them stay for the caller.
const drainAdmitted = async (run, each) => {
  const kept = new Fifo();
  while (run.slots.size > 0) {
    const slot = run.slots.shift();
    if (slot.admitted === undefined) kept.push(slot);
    else await each(slot.admitted);
  }
  run.slots = kept;
};

const sendRun = async function* (transport, run, options, gate) {
  let failed = false;
  try {
    for await (const receipt of transport.sendMany(feedRun(run, gate), options)) {
      // The answers in place before the message this receipt is for go first.
      while (run.slots.peek()?.receipt !== undefined) {
        run.inPlace--;
        yield run.slots.shift().receipt;
      }
      const slot = run.slots.shift();
      yield gate.settle === undefined ? receipt : await gate.settle(receipt, slot?.admitted);
    }
  } catch (error) {
    failed = true;
    if (gate.fail !== undefined) await drainAdmitted(run, (admitted) => gate.fail(error, admitted));
    throw error;
  } finally {
    // The caller stopped reading, or the transport answered fewer messages
    // than it was handed: those it was handed are neither settled nor failed.
    if (!failed && gate.abandon !== undefined) await drainAdmitted(run, gate.abandon);
  }
};

module.exports = { Fifo, gatedSendMany };
