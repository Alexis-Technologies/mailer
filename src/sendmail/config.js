// Ported from nodemailer v10.0.16 (src/sendmail-transport/index.ts): the
// options of the sendmail transport, `path`, `args` and `newline`.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
// Changed in the port: checked when the transport is made, with `spawn` passed
// in, LF line endings by default, and DKIM from ./mime.

const { checkDkimConfig } = require('../mime/dkim/types.js');

const NEWLINES = new Set(['lf', 'crlf']);

const throwTypeError = (message) => {
  throw new TypeError(message);
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
    spawn: config.spawn,
    dkim: config.dkim,
    generateId: config.generateId,
    logger: config.logger,
  };
};

module.exports = { createSendmailConfig };
