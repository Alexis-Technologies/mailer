// Not ported: the priorities of the jobs of a queue as the sources that lend
// them sort them (the memory queue, a store's outbox): high, then normal, then
// low; and the shape of a request such a source takes.

const RANK = new Map([
  ['high', 0],
  ['normal', 1],
  ['low', 2],
]);

/**
 * The rank of a priority, 0 the first: `undefined` for none.
 *
 * @internal
 */
const rankOf = (priority) => RANK.get(priority);

/**
 * Whether a value is the request of a job: an id, a name, its data, a
 * priority and its attempts.
 *
 * @internal
 */
const isJobRequest = (request) =>
  typeof request?.id === 'string' &&
  request.id !== '' &&
  typeof request.name === 'string' &&
  typeof request.data === 'object' &&
  request.data !== null &&
  RANK.has(request.priority) &&
  Number.isInteger(request.maxAttempts) &&
  request.maxAttempts >= 1;

module.exports = { isJobRequest, rankOf };
