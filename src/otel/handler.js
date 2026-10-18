// Not ported: OpenTelemetry for the worker of a queue, as a handler around
// any handler: a span per run of a job, linked to the trace of the producer
// that enqueued it, and the metrics of the queue (runs by outcome, the time a
// job waited, how long a run took, the runs again of jobs whose worker died).
// The providers are passed in, and @opentelemetry/api is never required.

const metadata = require('../version.js');
const { checkOptionalFunction } = require('../internal/options.js');

// SpanKind.CONSUMER and the SpanStatusCode values of the OpenTelemetry API.
const CONSUMER = 4;
const STATUS_OK = 1;
const STATUS_ERROR = 2;
// A W3C traceparent: version, trace id, parent id and flags.
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * The span context of a W3C traceparent, as a link takes it, or nothing.
 *
 * @param traceparent The text, from the job's `trace`.
 * @returns `{ traceId, spanId, traceFlags, isRemote }`, or `undefined`.
 * @internal
 */
const spanContextOf = (traceparent) => {
  if (typeof traceparent !== 'string') return undefined;
  const parts = TRACEPARENT.exec(traceparent);
  if (parts === null || parts[1] === 'ff') return undefined;
  if (/^0+$/.test(parts[2]) || /^0+$/.test(parts[3])) return undefined;
  return {
    traceId: parts[2],
    spanId: parts[3],
    traceFlags: Number.parseInt(parts[4], 16),
    isRemote: true,
  };
};

const checkOptions = (handler, options) => {
  if (typeof handler !== 'function') throw new TypeError('instrumentHandler needs a handler.');
  const tracing = options.tracing ?? true;
  const metrics = options.metrics ?? true;
  if (tracing && typeof options.tracerProvider?.getTracer !== 'function') {
    throw new TypeError('instrumentHandler needs a tracerProvider while tracing is on.');
  }
  if (metrics && typeof options.meterProvider?.getMeter !== 'function') {
    throw new TypeError('instrumentHandler needs a meterProvider while metrics are on.');
  }
  if (options.withSpan !== undefined && typeof options.withSpan !== 'function') {
    throw new TypeError('withSpan must be a function.');
  }
  return { tracing, metrics };
};

const instrumentsOf = (meterProvider) => {
  const meter = meterProvider.getMeter(metadata.name, metadata.version);
  return {
    jobs: meter.createCounter('mailer.queue.jobs', {
      description: 'The runs of mail jobs, by outcome and code.',
    }),
    lag: meter.createHistogram('mailer.queue.lag', {
      unit: 'ms',
      description: 'How long a job waited from its enqueue to the start of a run.',
    }),
    duration: meter.createHistogram('mailer.queue.job.duration', {
      unit: 'ms',
      description: 'How long a run of a mail job took.',
    }),
    redeliveries: meter.createCounter('mailer.queue.redeliveries', {
      description: 'The runs again of jobs whose run before did not settle.',
    }),
  };
};

/**
 * Wraps a queue handler, such as `createMailJobHandler()`, with OpenTelemetry:
 * a span `mailer.queue.process` per run, linked to the producer's trace (the
 * `traceparent` the mail queue's `traceContext` wrote as the job's `trace`),
 * and the metrics `mailer.queue.jobs` (by `outcome` and `code`),
 * `mailer.queue.lag`, `mailer.queue.job.duration` and
 * `mailer.queue.redeliveries`.
 *
 * @param handler The handler.
 * @param options `tracerProvider`, `meterProvider`; `tracing` and `metrics`
 * (true) to turn either off; `withSpan(span, run)`, which runs the handler
 * with the span active, so that the spans of the transport are its children
 * (`(span, run) => context.with(trace.setSpan(context.active(), span), run)`);
 * `now`.
 * @returns The handler, instrumented.
 * @throws {TypeError} If an option is invalid.
 */
const instrumentHandler = (handler, options = {}) => {
  const { tracing, metrics } = checkOptions(handler, options);
  const tracer = tracing
    ? options.tracerProvider.getTracer(metadata.name, metadata.version)
    : undefined;
  const instruments = metrics ? instrumentsOf(options.meterProvider) : undefined;
  const now = checkOptionalFunction(options.now, 'now') ?? Date.now;
  return async (job, signal) => {
    const started = now();
    const link = spanContextOf(job?.data?.trace);
    const span = tracer?.startSpan('mailer.queue.process', {
      kind: CONSUMER,
      attributes: {
        'messaging.system': 'mailer',
        'messaging.message.id': job.id,
        'mailer.job.attempt': job.attempt,
        'mailer.job.redelivered': job.redelivered === true,
      },
      links: link === undefined ? [] : [{ context: link }],
    });
    if (job.redelivered) instruments?.redeliveries.add(1);
    if (typeof job.enqueuedAt === 'number') instruments?.lag.record(started - job.enqueuedAt);
    let outcome;
    try {
      outcome =
        span !== undefined && options.withSpan !== undefined
          ? await options.withSpan(span, () => handler(job, signal))
          : await handler(job, signal);
    } catch (error) {
      instruments?.jobs.add(1, { outcome: 'thrown' });
      span?.setStatus({ code: STATUS_ERROR, message: 'The handler threw.' });
      span?.end();
      throw error;
    }
    const attributes = { outcome: outcome?.type ?? 'none' };
    if (typeof outcome?.code === 'string') attributes.code = outcome.code;
    instruments?.jobs.add(1, attributes);
    instruments?.duration.record(now() - started, attributes);
    if (span !== undefined) {
      span.setAttributes({
        'mailer.job.outcome': attributes.outcome,
        'mailer.job.code': attributes.code ?? '',
      });
      span.setStatus(
        outcome?.type === 'fail'
          ? { code: STATUS_ERROR, message: attributes.code }
          : { code: STATUS_OK },
      );
      span.end();
    }
    return outcome;
  };
};

module.exports = { instrumentHandler, spanContextOf };
