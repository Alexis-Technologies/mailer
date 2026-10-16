// Ported from upyo v0.7.0 (packages/jmap/src/raw-upload.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { analyzeRawMessage, iterateRawMessage } = require('../core/raw-message.js');
const { combineSignals } = require('../core/abort-signal.js');
const { parseRetryAfter } = require('../core/receipt.js');
const { JmapApiError } = require('./errors.js');
const { readJson, readText } = require('../internal/body.js');
const { Buffer } = require('node:buffer');

/** Runs a raw operation with a progress-resettable deadline through response parsing. @internal */
const rawOperation = async (timeout, operation, signal) => {
  const controller = new AbortController();
  const combined = combineSignals(controller.signal, signal);
  let timer;
  let finished = false;
  const progress = () => {
    if (finished) return;
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new JmapApiError('Raw JMAP operation timed out.')),
      timeout,
    );
  };
  let abort;
  try {
    combined.signal.throwIfAborted();
    progress();
    return await new Promise((resolve, reject) => {
      abort = () => reject(combined.signal.reason);
      combined.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve()
        .then(() => {
          combined.signal.throwIfAborted();
          return operation(combined.signal, progress);
        })
        .then(resolve, reject);
      if (combined.signal.aborted) abort();
    });
  } finally {
    finished = true;
    clearTimeout(timer);
    if (abort) combined.signal.removeEventListener('abort', abort);
    controller.abort();
    combined.cleanup();
  }
};

/** @internal */
const isRecord = (value) => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

// The one method response with a call id, or `undefined` when there is none
// or more than one.
const findOnlyResponse = (methodResponses, id) => {
  let found;
  for (const entry of methodResponses) {
    if (!Array.isArray(entry) || entry[2] !== id) continue;
    if (found !== undefined) return undefined;
    found = entry;
  }
  return found;
};

/** Streams validated MIME bytes without relying on fetch to cancel its body. @internal */
const uploadRawMessage = async (config, uploadUrl, accountId, plan, signal) => {
  return await rawOperation(
    config.timeout,
    async (outerSignal, progress) => {
      const analysis =
        plan.encoding === undefined
          ? await analyzeRawMessage(plan, outerSignal, progress)
          : { encoding: plan.encoding, size: plan.size };
      outerSignal.throwIfAborted();
      const source = createRawUploadBody(plan, analysis, outerSignal, progress);
      try {
        const response = await (config.fetch ?? globalThis.fetch)(
          uploadUrl.replace('{accountId}', encodeURIComponent(accountId)),
          {
            method: 'POST',
            headers: uploadHeaders(config),
            body: source.body,
            duplex: 'half',
            redirect: 'error',
            // Runtime cancellation of the request body must not discard a
            // response. The owned signal stops source reads; the outer signal
            // controls HTTP.
            signal: outerSignal,
          },
        );
        outerSignal.throwIfAborted();
        return await readUploadResult(response, accountId, source.state, outerSignal);
      } catch (error) {
        outerSignal.throwIfAborted();
        if (source.state.hasSourceError) throw source.state.sourceError;
        throw error;
      } finally {
        source.dispose();
      }
    },
    signal,
  );
};

/**
 * Gives the validated bytes of a plan as a request body that fetch pulls one
 * chunk at a time, under a signal of its own, so that reading the source stops
 * whether or not fetch cancels the body.
 *
 * @returns The `body`, its `state` (whether the source reached its end, the
 * bytes it gave and the error it failed with) and `dispose()`, which stops it.
 */
const createRawUploadBody = (plan, analysis, outerSignal, progress) => {
  const controller = new AbortController();
  const combined = combineSignals(controller.signal, outerSignal);
  const owned = combined.signal;
  const iterator = iterateRawMessage(plan, {
    signal: owned,
    encoding: analysis.encoding,
    expectedSize: analysis.size,
    onProgress: progress,
  })[Symbol.asyncIterator]();
  const state = { eof: false, size: 0, sourceError: undefined, hasSourceError: false };
  let closed = false;
  let bodyController;
  const close = (reason) => {
    if (closed) return;
    closed = true;
    controller.abort(reason);
    if (!state.eof) {
      try {
        Promise.resolve(iterator.return?.()).catch(() => {});
      } catch {
        /* Preserve the original failure. */
      }
    }
  };
  const abort = () => {
    try {
      bodyController?.error(owned.reason);
    } catch {
      /* Already closed. */
    }
    close(owned.reason);
  };
  const body = new ReadableStream(
    {
      start(stream) {
        bodyController = stream;
        owned.addEventListener('abort', abort, { once: true });
        if (owned.aborted) abort();
      },
      async pull(stream) {
        try {
          owned.throwIfAborted();
          const item = await iterator.next();
          owned.throwIfAborted();
          if (item.done) {
            state.eof = true;
            progress();
            stream.close();
          } else {
            state.size += item.value.length;
            stream.enqueue(new Uint8Array(item.value));
          }
        } catch (error) {
          if (!owned.aborted && !state.hasSourceError) {
            state.hasSourceError = true;
            state.sourceError = error;
          }
          try {
            stream.error(error);
          } catch {
            /* Already closed. */
          }
          close(error);
        }
      },
      cancel: close,
    },
    { highWaterMark: 0 },
  );
  const dispose = () => {
    owned.removeEventListener('abort', abort);
    close();
    combined.cleanup();
  };
  return { body, state, dispose };
};

const uploadHeaders = (config) => {
  const headers = new Headers(config.headers);
  if (!headers.has('Authorization')) {
    if (config.bearerToken) {
      headers.set('Authorization', `Bearer ${config.bearerToken}`);
    } else if (config.basicAuth) {
      const credentials = `${config.basicAuth.username}:${config.basicAuth.password}`;
      headers.set('Authorization', `Basic ${Buffer.from(credentials).toString('base64')}`);
    }
  }
  headers.set('Content-Type', 'message/rfc822');
  return headers;
};

/**
 * Reads the answer to a raw upload, which must come after the source reached
 * its end and name the blob of the bytes sent.
 *
 * @returns The uploaded blob.
 * @throws {JmapApiError} If the upload failed or its answer does not match.
 */
const readUploadResult = async (response, accountId, state, outerSignal) => {
  if (!response.ok) {
    throw new JmapApiError(
      `Raw upload failed: ${response.status}`,
      response.status,
      await readText(response),
      undefined,
      parseRetryAfter(response.headers.get('Retry-After')),
    );
  }
  if (!state.eof) {
    throw new JmapApiError('Raw upload responded before validated EOF.');
  }
  const result = await readJson(response);
  outerSignal.throwIfAborted();
  if (
    !isRecord(result) ||
    result.accountId !== accountId ||
    typeof result.blobId !== 'string' ||
    !result.blobId ||
    result.size !== state.size
  ) {
    throw new JmapApiError('Invalid raw upload response.');
  }
  return {
    accountId,
    blobId: result.blobId,
    size: state.size,
    type: typeof result.type === 'string' ? result.type : 'message/rfc822',
  };
};

module.exports = {
  findOnlyResponse,
  rawOperation,
  isRecord,
  uploadRawMessage,
};
