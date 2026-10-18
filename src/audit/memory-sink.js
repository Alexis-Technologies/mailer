// Not ported: an audit sink in memory, for tests and a single process: its
// events in the order they came, one per id, the oldest dropped past its
// bound.

const { checkPositiveInteger } = require('../internal/options.js');
const { stateOf } = require('./states.js');

/**
 * Makes an audit sink that holds its events in memory.
 *
 * @param options `maxEvents` (10000): past it, the oldest go first.
 * @returns The sink, with `events`, `eventsOf(correlationId)`,
 * `stateOf(correlationId)` and `clear()`.
 * @throws {TypeError} If `maxEvents` is not a positive integer.
 */
const createMemoryAuditSink = (options = {}) => {
  const maxEvents = checkPositiveInteger(options.maxEvents ?? 10000, 'maxEvents');
  const events = new Map();
  const eventsOf = (correlationId) => {
    const found = [];
    for (const event of events.values()) {
      if (event.correlationId === correlationId) found.push(event);
    }
    return found;
  };
  return {
    append(event) {
      if (typeof event?.id !== 'string') throw new TypeError('An audit event has an id.');
      // An event told again is written once, where it was first.
      if (events.has(event.id)) return;
      events.set(event.id, Object.freeze({ ...event }));
      if (events.size > maxEvents) events.delete(events.keys().next().value);
    },
    get events() {
      return [...events.values()];
    },
    eventsOf,
    stateOf: (correlationId) => stateOf(eventsOf(correlationId)),
    clear() {
      events.clear();
    },
  };
};

module.exports = { createMemoryAuditSink };
