// Not ported: the order of the states of a message, by which the state of
// its events is read whatever the order they came in: a `delivered` that
// comes before `delivery_unknown` is still delivered.

const RANKS = new Map([
  ['queued', 0],
  ['rendered', 1],
  ['submitted', 2],
  ['accepted', 3],
  ['delivery_unknown', 3],
  ['delivered', 4],
  ['failed', 4],
  ['bounced', 5],
  ['complained', 6],
]);

const FINAL = new Set(['delivered', 'bounced', 'complained', 'failed']);

/**
 * The place of a state in the order of states: of two events at one time and
 * attempt, the one further along came later.
 *
 * @internal
 */
const rankOf = (state) => RANKS.get(state) ?? -1;

/**
 * Whether no later state but a complaint follows: `delivered`, `bounced`,
 * `complained` and `failed`.
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
