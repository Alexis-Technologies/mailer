// Not ported: the check of `validateSsl`, in a module of its own so
// that only the providers that take the option bundle it.

/**
 * Checks `validateSsl`, which the global fetch cannot honor when false: it
 * checks every certificate, and Node gives no switch for it without undici.
 *
 * @param validateSsl The option, as configured.
 * @throws {TypeError} If it is anything but true or absent.
 * @internal
 */
const checkValidateSsl = (validateSsl) => {
  if (validateSsl === undefined || validateSsl === true) return;
  throw new TypeError(
    '`validateSsl: false` cannot be honored, as fetch checks every certificate; for a test ' +
      'server, pass a `fetch` of your own whose undici dispatcher does not, such as an Agent ' +
      'with `connect: { rejectUnauthorized: false }`.',
  );
};

module.exports = { checkValidateSsl };
