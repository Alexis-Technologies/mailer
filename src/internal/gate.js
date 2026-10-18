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

// The most answers in place a run holds while the messages handed to the
// wrapped transport before them wait for their receipts: past it, the run
// ends, so that a circuit open over an endless input is not read ahead
// without bound, and the answers held stay few.
const MAX_IN_PLACE = 64;

/**
 * Sends messages through a gate.  `gate.admit(message)` decides each one: `{
 * receipt }` answers it in place; `{ message, …state }` hands `message` to the
 * wrapped transport.  The admitted ones go through one `transport.sendMany()`,
 * the answers in place taking their turn among its receipts, so that a
 * transport that batches keeps its batches; a run ends only at the end of the
 * input or when `MAX_IN_PLACE` answers in place wait for earlier receipts.
 * Each receipt goes through `gate.settle(receipt, admitted)` before it is
 * yielded.  When the wrapped `sendMany()` throws, `gate.fail(error, admitted)`
 * hears of each message still waiting for its receipt; when the caller stops
 * reading, or the wrapped `sendMany()` ends short, `gate.abandon(admitted)`
 * does, as a transport that reads ahead may have sent them or not.  A message
 * admitted that the wrapped `sendMany()` never took goes to
 * `gate.unsent(admitted)` instead, when the gate has one: it was not sent.
 *
 * @param transport The wrapped transport.
 * @param messages The messages, sync or async.
 * @param options The caller's options, passed on.
 * @param gate `admit`, and optional `settle`, `fail`, `abandon` and `unsent`.
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
      // The first is admitted before the wrapped sendMany() takes it, which it
      // may never do: its slot is there from the start, not taken yet.
      const first = { admitted: decision, taken: false };
      const run = { iterator, first, slots: new Fifo(), inPlace: 0, exhausted: false };
      run.slots.push(first);
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
  run.first.taken = true;
  yield run.first.admitted.message;
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
    run.slots.push({ admitted: decision, taken: true });
    yield decision.message;
  }
};

// The messages of a run still waiting for their receipts, to be failed or
// abandoned, or told unsent when the wrapped sendMany() never took them; the
// answers in place among them stay for the caller.
const drainAdmitted = async (run, each, unsent) => {
  const kept = new Fifo();
  while (run.slots.size > 0) {
    const slot = run.slots.shift();
    if (slot.admitted === undefined) kept.push(slot);
    else if (!slot.taken && unsent !== undefined) await unsent(slot.admitted);
    else if (each !== undefined) await each(slot.admitted);
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
    const fail = gate.fail === undefined ? undefined : (admitted) => gate.fail(error, admitted);
    await drainAdmitted(run, fail, gate.unsent);
    throw error;
  } finally {
    // The caller stopped reading, or the transport answered fewer messages
    // than it was handed: those it was handed are neither settled nor failed.
    if (!failed) await drainAdmitted(run, gate.abandon, gate.unsent);
  }
};

module.exports = { Fifo, gatedSendMany };
