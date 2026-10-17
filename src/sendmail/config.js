// Ported from nodemailer v10.0.16 (src/sendmail-transport/index.ts): the
// options of the sendmail transport, `path`, `args` and `newline`.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
// Changed in the port: checked when the transport is made, with `spawn` passed
// in, LF line endings by default, DKIM from ./mime, and a timeout and a bound
// on the processes at once, which nodemailer had not.

const { checkDkimConfig } = require('../mime/dkim/types.js');

const NEWLINES = new Set(['lf', 'crlf']);

const throwTypeError = (message) => {
  throw new TypeError(message);
};

// 0 and Infinity mean none, as for the other transports.
const checkTimeout = (value) => {
  if (value === undefined) return 60_000;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throwTypeError(`timeout must be a non-negative number: ${value}`);
  }
  return value === 0 ? Number.POSITIVE_INFINITY : value;
};

const checkMaxConcurrent = (value) => {
  if (value === undefined) return 10;
  if (value !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(value) || value < 1)) {
    throwTypeError(`maxConcurrent must be a positive whole number or Infinity: ${value}`);
  }
  return value;
};

// An argument goes to the process as it is; only a NUL cannot.
const isArgument = (value) => typeof value === 'string' && !value.includes('\0');

const checkArgs = (args) => {
  if (args === undefined) return undefined;
  if (!Array.isArray(args)) throwTypeError('args must be an array of strings.');
  const checked = [];
  for (let i = 0; i < args.length; i++) {
    if (!isArgument(args[i])) throwTypeError(`Invalid sendmail argument at index ${i}.`);
    checked.push(args[i]);
  }
  return checked;
};

/**
 * Resolves the options of the sendmail transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createSendmailConfig = (config = {}) => {
  const path = config.path ?? 'sendmail';
  if (!isArgument(path) || path === '') throwTypeError('path must name the sendmail command.');
  const newline = config.newline ?? 'lf';
  if (!NEWLINES.has(newline)) throwTypeError(`newline must be 'lf' or 'crlf': ${newline}`);
  if (config.spawn !== undefined && typeof config.spawn !== 'function') {
    throwTypeError('spawn must be a function, such as child_process.spawn.');
  }
  checkDkimConfig(config.dkim);
  return {
    path,
    args: checkArgs(config.args),
    newline,
    timeout: checkTimeout(config.timeout),
    maxConcurrent: checkMaxConcurrent(config.maxConcurrent),
    spawn: config.spawn,
    dkim: config.dkim,
    generateId: config.generateId,
    logger: config.logger,
  };
};

module.exports = { createSendmailConfig };
