// Not ported from upyo: keeps credentials out of a transport that is logged,
// inspected or serialized.  The configuration stays readable as it is.

const { EventEmitter } = require('node:events');

/**
 * The key `util.inspect()` calls a custom inspection method under.
 */
const INSPECT = Symbol.for('nodejs.util.inspect.custom');

const REDACTED = '[REDACTED]';

// The credential fields of the transports' configurations, and the header
// names that carry credentials, compared in lower case.
const SECRET_KEYS = new Set([
  'accesstoken',
  'api-token',
  'apikey',
  'apitoken',
  'authorization',
  'bearertoken',
  'clientsecret',
  'cookie',
  'pass',
  'password',
  'privatekey',
  'proxy-authorization',
  'refreshtoken',
  'secret',
  'secretaccesskey',
  'sessiontoken',
  'token',
  'x-api-key',
  'x-lettermint-token',
]);

// Plain objects and class instances are copied; built-in values such as a
// Map, a Date, bytes or an AbortSignal are kept as they are, and an emitter,
// such as a socket, is named rather than walked.
const copyRedacted = (value, ancestors) => {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof EventEmitter) return `[${value.constructor.name}]`;
  const isArray = Array.isArray(value);
  if (!isArray && Object.prototype.toString.call(value) !== '[object Object]') return value;
  if (ancestors.has(value)) return '[Circular]';
  ancestors.add(value);
  let copy;
  if (isArray) {
    copy = [];
    for (let i = 0; i < value.length; i++) copy.push(copyRedacted(value[i], ancestors));
  } else {
    copy = {};
    for (const key of Object.keys(value)) {
      const isSecret = SECRET_KEYS.has(key.toLowerCase()) && value[key] != null;
      copy[key] = isSecret ? REDACTED : copyRedacted(value[key], ancestors);
    }
  }
  ancestors.delete(value);
  return copy;
};

/**
 * Copies an object with every credential replaced by `[REDACTED]`.
 *
 * @param value The object to copy, typically a transport.
 * @returns A plain copy without credentials.
 * @internal
 */
const redactSecrets = (value) => copyRedacted(value, new WeakSet());

/**
 * Inspects an object without its credentials, under its class name.
 *
 * @param value The object to inspect.
 * @param options The options `util.inspect()` passed to the custom method.
 * @param inspect The `util.inspect()` function it passed.
 * @returns The inspected text.
 * @internal
 */
const inspectRedacted = (value, options, inspect) =>
  `${value.constructor.name} ${inspect(redactSecrets(value), options)}`;

module.exports = { INSPECT, inspectRedacted, redactSecrets };
