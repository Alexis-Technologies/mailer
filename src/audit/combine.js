// Not ported: several audit sinks as one, each told every event in turn,
// whatever another threw.

/**
 * Makes one sink of several.
 *
 * @param sinks The sinks.
 * @returns A sink that appends to each; it rejects with what one threw, or an
 * `AggregateError` of what several threw, once all were told.
 * @throws {TypeError} If one is not a sink.
 */
const combineAuditSinks = (...sinks) => {
  for (const sink of sinks) {
    if (typeof sink?.append !== 'function') throw new TypeError('An audit sink has append().');
  }
  return {
    async append(event, context) {
      const errors = [];
      for (const sink of sinks) {
        try {
          await sink.append(event, context);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Audit sinks failed.');
    },
  };
};

module.exports = { combineAuditSinks };
