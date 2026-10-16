// Ported from upyo v0.7.0 (packages/smtp/src/data-stream.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { Buffer } = require('node:buffer');

/** Races preparation against source inactivity and remote socket termination. */
/**
 * Error produced when the connection fails after the end of the message data
 * went out: the server may have accepted the message, so whether it was
 * delivered is unknown, and sending it again may deliver it twice.
 */
class SmtpDeliveryUnknownError extends Error {
  /**
   * @param cause The failure of the connection: a close, a timeout or a
   * socket error.
   */
  constructor(cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`${reason} The message data had been sent; the server may have accepted it.`, {
      cause,
    });
    this.name = 'SmtpDeliveryUnknownError';
  }
}

/**
 * Copies a window of message data with a dot doubled at the start of every
 * line (RFC 5321 §4.5.2), finding the line feeds with indexOf rather than
 * looking at every byte.  The copy keeps the producer's bytes out of the
 * socket's queue.
 *
 * @param bytes The bytes to send.
 * @param isLineStart Whether the window starts a line.
 * @returns The bytes to write.
 */
const stuffDots = (bytes, isLineStart) => {
  const window = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dots = isLineStart && window[0] === 0x2e ? 1 : 0;
  for (let end = window.indexOf(0x0a); end !== -1; end = window.indexOf(0x0a, end + 1)) {
    if (window[end + 1] === 0x2e) dots++;
  }
  const output = Buffer.allocUnsafe(window.length + dots);
  if (dots === 0) {
    window.copy(output);
    return output;
  }
  let written = 0;
  let start = 0;
  if (isLineStart && window[0] === 0x2e) output[written++] = 0x2e;
  for (let end = window.indexOf(0x0a); end !== -1; end = window.indexOf(0x0a, end + 1)) {
    if (window[end + 1] !== 0x2e) continue;
    written += window.copy(output, written, start, end + 1);
    output[written++] = 0x2e;
    start = end + 1;
  }
  window.copy(output, written, start);
  return output;
};

const prepareOnSocket = async (socket, timeoutMs, prepare, signal) => {
  const controller = new AbortController();
  const combined = combineSignals(controller.signal, signal);
  const fail = (error) => controller.abort(error);
  const closed = () => fail(new TypeError('SMTP connection closed during message preparation.'));
  const data = () => fail(new TypeError('Unexpected SMTP reply during message preparation.'));
  let timer;
  const progress = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fail(new TypeError('SMTP message preparation timeout.')), timeoutMs);
  };
  socket.on('error', fail);
  socket.on('close', closed);
  socket.on('data', data);
  progress();
  try {
    if (socket.destroyed || !socket.writable) closed();
    combined.signal.throwIfAborted();
    return await abortable(prepare(combined.signal, progress), combined.signal);
  } catch (error) {
    const interrupted = combined.signal.aborted;
    controller.abort(error);
    if (interrupted) socket.destroy();
    signal?.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
    socket.off('error', fail);
    socket.off('close', closed);
    socket.off('data', data);
    combined.cleanup();
  }
};

const abortable = (promise, signal) => {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
};

/**
 * Writes bytes to the socket and waits until it has taken them and drained,
 * under the signal of the DATA phase.
 *
 * @param socket The connected socket.
 * @param bytes The bytes to write.
 * @param owned The signal of the DATA phase.
 * @param progress Restarts the timeout of the phase.
 * @returns A promise that settles once the write is done and drained.
 */
const writeToSocket = (socket, bytes, owned, progress) => {
  owned.throwIfAborted();
  return abortable(
    new Promise((resolve, reject) => {
      let written = false;
      let drained = false;
      let returned = false;
      const cleanup = () => {
        socket.off('drain', drain);
        owned.removeEventListener('abort', cleanup);
      };
      const finish = () => {
        if (returned && written && drained) {
          cleanup();
          progress();
          resolve();
        }
      };
      const drain = () => {
        drained = true;
        finish();
      };
      socket.once('drain', drain);
      owned.addEventListener('abort', cleanup, { once: true });
      try {
        const accepted = socket.write(bytes, (error) => {
          if (error != null) {
            cleanup();
            reject(error);
            return;
          }
          written = true;
          finish();
        });
        drained = accepted || drained;
        returned = true;
        finish();
      } catch (error) {
        cleanup();
        reject(error);
      }
    }),
    owned,
  );
};

const DATA_WINDOW_BYTES = 32768;

/**
 * Writes the message from its source, dot-stuffed (RFC 5321 §4.5.2), in
 * windows of at most 32 KiB, checking the size as it grows.
 *
 * @param iterator The iterator of the message bytes.
 * @param write Writes bytes to the socket.
 * @param owned The signal of the DATA phase.
 * @param checkSize Throws when the size passes the limit of the server.
 * @param progress Restarts the timeout of the phase.
 */
const writeBody = async (iterator, write, owned, checkSize, progress) => {
  let lineStart = true;
  let size = 0;
  while (true) {
    owned.throwIfAborted();
    const item = await abortable(Promise.resolve(iterator.next()), owned);
    if (item.done) return;
    const chunk = item.value;
    for (let offset = 0; offset < chunk.length; offset += DATA_WINDOW_BYTES) {
      const window = chunk.subarray(offset, offset + DATA_WINDOW_BYTES);
      size += window.length;
      checkSize(size);
      progress();
      const output = stuffDots(window, lineStart);
      lineStart = window[window.length - 1] === 0x0a;
      await write(output);
    }
  }
};

const MAX_DATA_REPLY_BYTES = 65536;

/**
 * Reads the reply to the end of DATA as its bytes arrive, bounded to 64 KiB.
 *
 * @param isTerminated Whether the terminating dot has been written: a reply
 * before it is premature.
 * @param onReply Takes the reply at its final line.
 * @param fail Takes the error of a premature or oversized reply.
 * @returns The listener of the socket's data.
 */
const createDataReplyReader = (isTerminated, onReply, fail) => {
  let replyBytes = 0;
  let buffer = '';
  const lines = [];
  return (chunk) => {
    replyBytes += chunk.length;
    if (replyBytes > MAX_DATA_REPLY_BYTES) {
      fail(new RangeError('SMTP DATA reply exceeds 64 KiB.'));
      return;
    }
    buffer += Buffer.from(chunk).toString('utf8');
    let end;
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      lines.push(line);
      // RFC 5321 §4.2: a final line is the code alone or with a space.
      if (/^\d{3}(?: |$)/.test(line)) {
        if (!isTerminated()) {
          fail(new TypeError(`Premature SMTP DATA reply: ${line}`));
        } else {
          onReply({
            code: Number(line.slice(0, 3)),
            message: line.slice(4),
            raw: lines.join('\r\n'),
          });
        }
        return;
      }
    }
  };
};

/** Writes one DATA body with bounded transparency buffers and backpressure. */
const writeMessageData = async (socket, source, timeoutMs, checkSize, signal) => {
  const controller = new AbortController();
  const combined = combineSignals(controller.signal, signal);
  const owned = combined.signal;
  let terminated = false;
  let complete = false;
  let resolveReply;
  const reply = new Promise((resolve) => (resolveReply = resolve));
  // Once the terminating dot is on its way, a failure of the connection can
  // no longer tell whether the server accepted the message.
  const fail = (error) => {
    if (!owned.aborted) {
      controller.abort(terminated ? new SmtpDeliveryUnknownError(error) : error);
    }
    socket.destroy();
  };
  const close = () => fail(new TypeError('SMTP connection closed during DATA.'));
  const onAbort = () => socket.destroy();
  let timer;
  const progress = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fail(new TypeError('SMTP DATA timeout.')), timeoutMs);
  };
  const data = createDataReplyReader(
    () => terminated,
    (finalReply) => resolveReply(finalReply),
    fail,
  );
  socket.on('error', fail);
  socket.on('close', close);
  socket.on('data', data);
  owned.addEventListener('abort', onAbort, { once: true });
  progress();
  let iterator;
  const write = (bytes) => writeToSocket(socket, bytes, owned, progress);
  try {
    iterator = source(owned, progress)[Symbol.asyncIterator]();
    if (socket.destroyed || !socket.writable) close();
    await writeBody(iterator, write, owned, checkSize, progress);
    owned.throwIfAborted();
    terminated = true;
    await write(Buffer.from('.\r\n'));
    const result = await abortable(reply, owned);
    owned.throwIfAborted();
    complete = true;
    return result;
  } catch (error) {
    fail(error);
    signal?.throwIfAborted();
    throw owned.reason;
  } finally {
    if (!complete) {
      try {
        Promise.resolve(iterator?.return?.()).catch(() => {});
      } catch {
        /* Preserve the send failure. */
      }
    }
    clearTimeout(timer);
    socket.off('error', fail);
    socket.off('close', close);
    socket.off('data', data);
    owned.removeEventListener('abort', onAbort);
    combined.cleanup();
  }
};

module.exports = { SmtpDeliveryUnknownError, prepareOnSocket, writeMessageData };
