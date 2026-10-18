// Not ported: a wait for a promise bounded in time, for the close() of the
// queue drivers, which wait for the jobs in flight and then stop waiting.

/**
 * Whether a promise settles within a time: what it gives, or `'timeout'`.
 *
 * @param promise The promise, whose rejection is the caller's to handle.
 * @param milliseconds The time.
 * @returns What it gave, or `'timeout'`.
 * @internal
 */
const settledWithin = async (promise, milliseconds) => {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(resolve, milliseconds, 'timeout');
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { settledWithin };
