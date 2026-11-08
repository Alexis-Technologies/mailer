// Not ported: a wait for a promise that ends when a signal aborts, apart from
// abort.js, which every transport loads, as only those that wait for a token
// or for credentials need it.

const { abortReason } = require('./abort.js');

/**
 * Waits for a promise until a signal aborts: what one caller waits for, and
 * stops waiting for when its signal aborts, while others may go on waiting
 * for the same promise.
 *
 * @param promise The promise.
 * @param signal The caller's signal, or none.
 * @returns What the promise gives.
 * @throws The reason of the signal if it aborts first.
 * @internal
 */
const untilAborted = async (promise, signal) => {
  if (signal === undefined) return promise;
  if (signal.aborted) throw abortReason(signal);
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
};

module.exports = { untilAborted };
