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
// default; an abort kills the process; and `spawn` is passed in.

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
const { createFailedReceipt } = require('../core/receipt.js');
const { createLog } = require('../internal/log.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { redactAddresses } = require('../internal/redact-addresses.js');
const { refuseScheduledAt } = require('../internal/schedule.js');
const { composeMessage } = require('../mime/index.js');
const { createSendmailConfig } = require('./config.js');

const MAX_STDERR_BYTES = 4096;
const CR = 0x0d;

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

const isCallerAbort = (error, signal) =>
  signal?.aborted === true && (error === signal.reason || error?.name === 'AbortError');

const failureOf = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RawMessageValidationError) {
    return createFailedReceipt(message, { provider: 'sendmail', category: 'validation' });
  }
  return createFailedReceipt(message, { provider: 'sendmail' });
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

/**
 * Runs sendmail on a message and waits for it to exit.
 *
 * @returns `{ code, signal, stderr, written, error, contentError }`.
 */
const run = (child, chunks, newline, abort) =>
  new Promise((resolve, reject) => {
    const outcome = { written: false };
    const stderrOf = collectStderr(child.stderr);
    child.stdin?.on('error', () => {});
    const onAbort = () => {
      child.kill();
      reject(abort.reason);
    };
    abort?.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error) => {
      abort?.removeEventListener('abort', onAbort);
      resolve({ ...outcome, error });
    });
    child.once('close', (code, killSignal) => {
      abort?.removeEventListener('abort', onAbort);
      resolve({ ...outcome, code, signal: killSignal, stderr: stderrOf() });
    });
    writeMessage(child.stdin, chunks, newline).then(
      (written) => {
        outcome.written = written;
        return written;
      },
      (error) => {
        // The message could not be read: sendmail must not deliver a part.
        outcome.contentError = error;
        child.kill('SIGINT');
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
  if (result.code === 0 && result.signal == null) {
    return { successful: true, messageId, provider: 'sendmail' };
  }
  const said = result.stderr === '' ? '' : `: ${redactAddresses(result.stderr)}`;
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
    let child;
    try {
      args = argsOf(this.config, envelope);
      const spawn = this.config.spawn ?? childProcess.spawn;
      child = spawn(this.config.path, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      return failureOf(error);
    }
    this.#log.write('debug', () => ({ recipients: envelope.to.length }), 'sendmail started');
    const result = await run(child, chunks, this.config.newline, signal);
    const receipt = receiptOf(result, this.config.path, messageId);
    this.#log.write(
      'debug',
      () => ({ code: result.code, signal: result.signal, successful: receipt.successful }),
      'sendmail exited',
    );
    return receipt;
  }
}

module.exports = { SendmailTransport };
