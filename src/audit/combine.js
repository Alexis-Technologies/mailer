// Not ported: several audit sinks as one, each told every event in turn,
// whatever another threw.

/**
 * Makes one sink of several.
 *
 * @param sinks The sinks.
 * @returns A sink that appends to each; it rejects with what one threw, or an
 * `AggregateError` of what several threw, once all were told. It has `has`
 * when one of them has: true when any holds the event.
 * @throws {TypeError} If one is not a sink.
 */
const combineAuditSinks = (...sinks) => {
  for (const sink of sinks) {
    if (typeof sink?.append !== 'function') throw new TypeError('An audit sink has append().');
  }
  // `has`, when a sink can tell: an event any of them holds was written.
  let readable = false;
  for (const sink of sinks) readable ||= typeof sink.has === 'function';
  const combined = {
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
  if (readable) {
    combined.has = async (id) => {
      for (const sink of sinks) {
        if (typeof sink.has === 'function' && (await sink.has(id))) return true;
      }
      return false;
    };
  }
  return combined;
};

module.exports = { combineAuditSinks };
