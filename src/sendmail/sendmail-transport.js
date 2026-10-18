// Ported from nodemailer v10.0.16 (src/sendmail-transport/index.ts): a
// transport that pipes each message to the sendmail command of the system.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
// Changed in the port: the message is composed by ./mime (DKIM, IDN, the
// transfer encodings) without a Bcc field, its blind recipients going on the
// command line only, where nodemailer kept the field for sendmail to strip;
// `--` ends the options before the recipients; success is an exit with code 0
// alone, where nodemailer took a process killed by a signal (code null) for
// success and handed the code of `close` on as an error; what sendmail writes
// to stderr is read, bounded, into the failure; line endings are LF by
// default; an abort or the timeout kills the process, with SIGKILL after a
// grace; no more than `maxConcurrent` processes run at once; an exit with 0
// before the whole message was read is of unknown delivery; and `spawn` is
// passed in.

const childProcess = require('node:child_process');
const { once } = require('node:events');
const fsp = require('node:fs/promises');
const nodePath = require('node:path');
const { generateId } = require('../core/id.js');
const { parseMessageId, pinMessageId } = require('../core/message-id.js');
const {
  createRawMessagePlan,
  iterateRawMessage,
  RawMessageValidationError,
} = require('../core/raw-message.js');
const { classifyReceiptError, createFailedReceipt } = require('../core/receipt.js');
const { refusalFailure } = require('../internal/refusal.js');
const { createLog } = require('../internal/log.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { redactAddresses } = require('../internal/redact-addresses.js');
const { refuseScheduledAt } = require('../internal/schedule.js');
const { abortReason, isCallerAbort, timerMs } = require('../internal/sleep.js');
const { Fifo } = require('../internal/gate.js');
const { composeMessage } = require('../mime/index.js');
const { createSendmailConfig } = require('./config.js');

const MAX_STDERR_BYTES = 4096;
const CR = 0x0d;
// How long a process asked to stop with SIGTERM has before SIGKILL.
const KILL_GRACE_MS = 5000;

// sysexits.h: the category of a failure by the exit status of sendmail, and
// whether a later attempt may pass.  A status sendmail gives says it did not
// take the message.
const EXIT_STATUSES = new Map([
  [64, { category: 'configuration', retryable: false }],
  [65, { category: 'validation', retryable: false }],
  [67, { category: 'rejected', retryable: false }],
  [68, { category: 'rejected', retryable: false }],
  [69, { category: 'service-unavailable', retryable: true }],
  [75, { category: 'service-unavailable', retryable: true }],
  [77, { category: 'configuration', retryable: false }],
  [78, { category: 'configuration', retryable: false }],
  [126, { category: 'configuration', retryable: false }],
  [127, { category: 'configuration', retryable: false }],
]);

const failureOf = (error) => {
  const refusal = refusalFailure('sendmail', error);
  if (refusal !== undefined) return refusal;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RawMessageValidationError) {
    return createFailedReceipt(message, { provider: 'sendmail', category: 'validation' });
  }
  // By the codes along its causes first, then by its words.
  const { category, retryable } = classifyReceiptError(error);
  return createFailedReceipt(message, { provider: 'sendmail', category, retryable });
};

// An address that would read as an option, as nodemailer refuses it; `--`
// keeps the recipients from being read as one too.
const checkArgument = (address) => {
  if (address.startsWith('-') || address.startsWith('"-')) {
    throw new TypeError('A sendmail envelope address must not start with "-".');
  }
  return address;
};

const argsOf = (config, envelope) => {
  const args = ['-i'];
  if (config.args === undefined) {
    args.push('-f', envelope.from == null ? '<>' : checkArgument(envelope.from));
  } else {
    for (let i = 0; i < config.args.length; i++) args.push(config.args[i]);
  }
  args.push('--');
  for (let i = 0; i < envelope.to.length; i++) args.push(checkArgument(envelope.to[i]));
  return args;
};

// The message as LF lines.  Every CR of what is written is the CR of a CRLF:
// ./mime writes CRLF alone, and a raw message with a bare CR is refused as it
// is read, so dropping each CR leaves the LF of each line.
const withoutCr = (chunk) => {
  let crs = 0;
  for (let i = 0; i < chunk.length; i++) if (chunk[i] === CR) crs++;
  if (crs === 0) return chunk;
  const out = new Uint8Array(chunk.length - crs);
  let length = 0;
  for (let i = 0; i < chunk.length; i++) if (chunk[i] !== CR) out[length++] = chunk[i];
  return out;
};

// Waits for room in the pipe, or for it to close with the process.
const drained = async (stdin) => {
  const settled = new AbortController();
  try {
    await Promise.race([
      once(stdin, 'drain', { signal: settled.signal }),
      once(stdin, 'close', { signal: settled.signal }),
    ]);
  } finally {
    settled.abort();
  }
};

// Writes the message to the process; an error of the content is thrown, one of
// the pipe (the process went away) left to its exit status.
const writeMessage = async (stdin, chunks, newline) => {
  for await (const chunk of chunks) {
    if (stdin.destroyed) return false;
    if (!stdin.write(newline === 'lf' ? withoutCr(chunk) : chunk)) await drained(stdin);
  }
  if (stdin.destroyed) return false;
  stdin.end();
  return true;
};

const collectStderr = (stream) => {
  const chunks = [];
  let size = 0;
  stream?.on('data', (chunk) => {
    if (size >= MAX_STDERR_BYTES) return;
    const part = chunk.subarray(0, MAX_STDERR_BYTES - size);
    chunks.push(part);
    size += part.length;
  });
  return () => Buffer.concat(chunks, size).toString('utf8').trim();
};

// Asks the process to stop, and makes it if it does not within the grace.
const terminate = (child, signal = 'SIGTERM') => {
  child.kill(signal);
  const timer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
  timer.unref?.();
  child.once('close', () => clearTimeout(timer));
};

/**
 * Runs sendmail on a message and waits for it to exit, or for `timeout`.
 *
 * @returns `{ code, signal, stderr, written, timedOut, error, contentError }`.
 */
const run = (child, chunks, newline, abort, timeout) =>
  new Promise((resolve, reject) => {
    const outcome = { written: false, timedOut: false };
    const stderrOf = collectStderr(child.stderr);
    child.stdin?.on('error', () => {});
    const onAbort = () => {
      terminate(child);
      reject(abortReason(abort));
    };
    abort?.addEventListener('abort', onAbort, { once: true });
    const timer =
      timeout === Number.POSITIVE_INFINITY
        ? undefined
        : setTimeout(() => {
            outcome.timedOut = true;
            terminate(child);
          }, timerMs(timeout));
    const done = () => {
      clearTimeout(timer);
      abort?.removeEventListener('abort', onAbort);
    };
    child.once('error', (error) => {
      done();
      resolve({ ...outcome, error });
    });
    child.once('close', (code, killSignal) => {
      done();
      resolve({ ...outcome, code, signal: killSignal, stderr: stderrOf() });
    });
    writeMessage(child.stdin, chunks, newline).then(
      (written) => {
        outcome.written = written;
        return written;
      },
      (error) => {
        // The message could not be read: sendmail must not deliver a part, and
        // one that does not stop on SIGINT is killed after the grace, so that
        // it holds no place among maxConcurrent with no timeout to end it.
        outcome.contentError = error;
        terminate(child, 'SIGINT');
      },
    );
  });

const receiptOf = (result, path, messageId) => {
  if (result.error !== undefined) {
    const missing = result.error.code === 'ENOENT';
    const text = missing ? `sendmail was not found: ${path}` : result.error.message;
    return createFailedReceipt(text, {
      provider: 'sendmail',
      category: missing ? 'configuration' : undefined,
      retryable: missing ? false : undefined,
    });
  }
  if (result.contentError !== undefined) return failureOf(result.contentError);
  const said = result.stderr === '' ? '' : `: ${redactAddresses(result.stderr)}`;
  if (result.timedOut) {
    // Stopped once it had the whole message, it may have queued it.
    return createFailedReceipt(`sendmail did not exit in time${said}`, {
      provider: 'sendmail',
      category: 'timeout',
      retryable: !result.written,
      deliveryUnknown: result.written,
    });
  }
  if (result.code === 0 && result.signal == null) {
    if (result.written) return { successful: true, messageId, provider: 'sendmail' };
    // It took a part of the message, or none, and said it was done: what it
    // queued, if anything, is not the message.
    return createFailedReceipt(`sendmail exited before it read the whole message${said}`, {
      provider: 'sendmail',
      category: 'server-error',
      deliveryUnknown: true,
    });
  }
  if (result.code == null) {
    // Killed once it had the whole message, it may have queued it.
    return createFailedReceipt(`sendmail was killed by ${result.signal}${said}`, {
      provider: 'sendmail',
      category: 'server-error',
      retryable: !result.written,
      deliveryUnknown: result.written,
    });
  }
  const status = EXIT_STATUSES.get(result.code) ?? { category: 'server-error', retryable: false };
  return createFailedReceipt(`sendmail exited with code ${result.code}${said}`, {
    provider: 'sendmail',
    ...status,
  });
};

// The command as sendmail would be run: a path, or a name on PATH.
const findCommand = async (command) => {
  const candidates = [];
  if (command.includes('/') || command.includes('\\')) candidates.push(command);
  else {
    for (const directory of (process.env.PATH ?? '').split(nodePath.delimiter)) {
      if (directory !== '') candidates.push(nodePath.join(directory, command));
    }
  }
  for (const candidate of candidates) {
    try {
      await fsp.access(candidate, fsp.constants.X_OK);
      return candidate;
    } catch {
      // The next one.
    }
  }
  throw new Error(`sendmail was not found: ${command}`);
};

/**
 * A transport that pipes each message to the sendmail command of the system
 * (Postfix, Exim, sendmail, msmtp, …), one process per message.
 */
class SendmailTransport {
  id = 'sendmail';
  #log;
  #running = 0;
  #waiting = new Fifo();

  constructor(config = {}) {
    this.config = createSendmailConfig(config);
    this.#log = createLog(this.config.logger, { transport: 'sendmail' });
  }

  toJSON() {
    return redactSecrets(this);
  }

  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Composes a message and pipes it to sendmail.
   *
   * @param message The message.
   * @param options `signal`, which kills the process.
   * @returns A receipt with the Message-ID of the message.
   * @throws The reason of `signal` if it aborts.
   */
  async send(message, options) {
    const signal = options?.signal;
    signal?.throwIfAborted();
    let composed;
    let pinned;
    try {
      refuseScheduledAt(message, 'sendmail');
      pinned = pinMessageId(message, this.config.generateId);
      composed = await composeMessage(pinned, {
        signal,
        dkim: this.config.dkim,
        generateId: this.config.generateId,
        logger: this.config.logger,
      });
    } catch (error) {
      if (isCallerAbort(error, signal)) throw error;
      return failureOf(error);
    }
    const messageId =
      pinned.messageId ?? parseMessageId(pinned.headers.get('Message-ID') ?? '') ?? '';
    return this.deliver(composed.envelope, composed.content(signal), messageId, signal);
  }

  /**
   * Sends each message in turn, a process each.
   */
  async *sendMany(messages, options) {
    for await (const message of messages) yield await this.send(message, options);
  }

  /**
   * Pipes serialized MIME to sendmail unchanged but for its line endings, to
   * the recipients of its envelope.
   */
  async sendRaw(message, options) {
    const signal = options?.signal;
    if (message?.content instanceof Promise) message.content.catch(() => {});
    signal?.throwIfAborted();
    let plan;
    try {
      plan = createRawMessagePlan(message);
    } catch (error) {
      return failureOf(error);
    }
    const messageId = generateId('receipt-id', this.config.generateId);
    return this.deliver(plan.envelope, iterateRawMessage(plan, { signal }), messageId, signal);
  }

  /**
   * Checks that the command can be run: `path` itself, or a file of that name
   * on PATH that is executable.  With `spawn` passed in, which decides what
   * runs, it checks nothing.
   *
   * @throws {Error} If no such command is found.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    if (this.config.spawn === undefined) await findCommand(this.config.path);
  }

  async deliver(envelope, chunks, messageId, signal) {
    let args;
    try {
      args = argsOf(this.config, envelope);
    } catch (error) {
      return failureOf(error);
    }
    await this.#acquire(signal);
    let child;
    try {
      const spawn = this.config.spawn ?? childProcess.spawn;
      child = spawn(this.config.path, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      this.#release();
      return failureOf(error);
    }
    // The place is the process's until it has exited, an aborted one too.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.#release();
    };
    child.once('close', release);
    child.once('error', release);
    this.#log.write('debug', () => ({ recipients: envelope.to.length }), 'sendmail started');
    const result = await run(child, chunks, this.config.newline, signal, this.config.timeout);
    const receipt = receiptOf(result, this.config.path, messageId);
    this.#log.write(
      'debug',
      () => ({ code: result.code, signal: result.signal, successful: receipt.successful }),
      'sendmail exited',
    );
    return receipt;
  }

  // Waits for a place among the `maxConcurrent` processes, first come first
  // served; an abort leaves the queue.
  #acquire(signal) {
    if (this.#running < this.config.maxConcurrent) {
      this.#running++;
      return undefined;
    }
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const waiter = { resolve, cancelled: false, signal, onAbort: undefined };
      if (signal !== undefined) {
        waiter.onAbort = () => {
          waiter.cancelled = true;
          reject(abortReason(signal));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.#waiting.push(waiter);
    });
  }

  // Hands the place on to the next waiter, or frees it.
  #release() {
    while (this.#waiting.size > 0) {
      const next = this.#waiting.shift();
      if (next.cancelled) continue;
      next.signal?.removeEventListener('abort', next.onAbort);
      next.resolve();
      return;
    }
    this.#running--;
  }
}

module.exports = { SendmailTransport };
