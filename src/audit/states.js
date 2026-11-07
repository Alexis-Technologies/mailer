// Not ported: the order of the states of a message, by which the state of
// its events is read whatever the order they came in: a `delivered` that
// comes before `delivery_unknown` is still delivered. A store of audit events
// keeps the rank of each (the MongoDB sink sorts by it), so the states of the
// channels take ranks between those of 1.2 rather than moving them.

const RANKS = new Map([
  ['queued', 0],
  ['rendered', 1],
  ['submitted', 2],
  ['accepted', 3],
  ['delivery_unknown', 3],
  // To the carrier or the platform: the last state of a channel that tells
  // no delivery, and what settles a delivery unknown.
  ['sent', 3.5],
  ['delivered', 4],
  ['failed', 4],
  ['expired', 4],
  ['read', 4.5],
  ['bounced', 5],
  ['complained', 6],
]);

const FINAL = new Set(['delivered', 'bounced', 'complained', 'failed', 'read', 'expired']);

/**
 * The place of a state in the order of states: of two events at one time and
 * attempt, the one further along came later.
 *
 * @internal
 */
const rankOf = (state) => RANKS.get(state) ?? -1;

/**
 * Whether no later state follows but a read or a complaint: `delivered`,
 * `read`, `bounced`, `complained`, `failed` and `expired`.
 *
 * @param state A state of a message.
 * @returns `true` for a final state.
 */
const isFinalState = (state) => FINAL.has(state);

/**
 * The state of a message from its events: the furthest one, the later of two
 * as far.
 *
 * @param events The audit events of one message.
 * @returns The state, or `undefined` for none.
 */
const stateOf = (events) => {
  let state;
  let rank = -1;
  for (const event of events) {
    const at = RANKS.get(event.state);
    if (at !== undefined && at >= rank) {
      rank = at;
      state = event.state;
    }
  }
  return state;
};

module.exports = { isFinalState, rankOf, stateOf };
