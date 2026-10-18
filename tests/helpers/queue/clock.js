// Not ported: a clock for the tests of ./queue: `now` moves only when told,
// and a sleep ends when the clock passes its time or its signal aborts.

const manualClock = (start = Date.parse('2026-10-18T00:00:00Z')) => {
  let time = start;
  const sleepers = new Set();
  const wakeDue = () => {
    for (const sleeper of sleepers) {
      if (sleeper.until <= time) {
        sleepers.delete(sleeper);
        sleeper.resolve();
      }
    }
  };
  return {
    now: () => time,
    sleep: (milliseconds, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const sleeper = { until: time + milliseconds, resolve };
        sleepers.add(sleeper);
        signal?.addEventListener(
          'abort',
          () => {
            sleepers.delete(sleeper);
            reject(signal.reason);
          },
          { once: true },
        );
      }),
    advance(milliseconds) {
      time += milliseconds;
      wakeDue();
    },
  };
};

module.exports = { manualClock };
