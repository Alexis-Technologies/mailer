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
      const controller = new AbortController();
      const combined = combineSignals(controller.signal, outerSignal);
      const owned = combined.signal;
      const iterator = iterateRawMessage(plan, {
        signal: owned,
        encoding: analysis.encoding,
        expectedSize: analysis.size,
        onProgress: progress,
      })[Symbol.asyncIterator]();
      let closed = false;
      let eof = false;
      let size = 0;
      let sourceError;
      let hasSourceError = false;
      let bodyController;
      const close = (reason) => {
        if (closed) return;
        closed = true;
        controller.abort(reason);
        if (!eof) {
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
                eof = true;
                progress();
                stream.close();
              } else {
                size += item.value.length;
                stream.enqueue(new Uint8Array(item.value));
              }
            } catch (error) {
              if (!owned.aborted && !hasSourceError) {
                hasSourceError = true;
                sourceError = error;
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
      const headers = new Headers(config.headers);
      if (!headers.has('Authorization')) {
        if (config.bearerToken) {
          headers.set('Authorization', `Bearer ${config.bearerToken}`);
        } else if (config.basicAuth) {
          headers.set(
            'Authorization',
            `Basic ${Buffer.from(`${config.basicAuth.username}:${config.basicAuth.password}`).toString('base64')}`,
          );
        }
      }
      headers.set('Content-Type', 'message/rfc822');
      const request = {
        method: 'POST',
        headers,
        body,
        duplex: 'half',
        redirect: 'error',
        // Runtime cancellation of the request body must not discard a response.
        // The owned signal stops source reads; the outer signal controls HTTP.
        signal: outerSignal,
      };
      try {
        const response = await (config.fetch ?? globalThis.fetch)(
          uploadUrl.replace('{accountId}', encodeURIComponent(accountId)),
          request,
        );
        outerSignal.throwIfAborted();
        if (!response.ok) {
          throw new JmapApiError(
            `Raw upload failed: ${response.status}`,
            response.status,
            await readText(response),
            undefined,
            parseRetryAfter(response.headers.get('Retry-After')),
          );
        }
        if (!eof) {
          throw new JmapApiError('Raw upload responded before validated EOF.');
        }
        const result = await readJson(response);
        outerSignal.throwIfAborted();
        if (
          !isRecord(result) ||
          result.accountId !== accountId ||
          typeof result.blobId !== 'string' ||
          !result.blobId ||
          result.size !== size
        ) {
          throw new JmapApiError('Invalid raw upload response.');
        }
        return {
          accountId,
          blobId: result.blobId,
          size,
          type: typeof result.type === 'string' ? result.type : 'message/rfc822',
        };
      } catch (error) {
        outerSignal.throwIfAborted();
        if (hasSourceError) throw sourceError;
        throw error;
      } finally {
        owned.removeEventListener('abort', abort);
        close();
        combined.cleanup();
      }
    },
    signal,
  );
};

module.exports = { rawOperation, isRecord, uploadRawMessage };
