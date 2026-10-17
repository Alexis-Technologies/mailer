// Ported from upyo v0.7.0 (packages/smtp/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// Also ported from nodemailer v10.0.16 (src/smtp-connection/index.ts): the name
// EHLO gives by default, `_getHostname`.
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman

const { isIP } = require('node:net');
const os = require('node:os');
const { checkDkimConfig } = require('../mime/dkim/types.js');

/**
 * Creates a resolved SMTP configuration by applying default values to optional fields.
 *
 * This function takes a partial SMTP configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the SMTP transport.
 *
 * @param config - The SMTP configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */
const createSmtpConfig = (config) => {
  checkDkimConfig(config.dkim);
  checkAuthMethod(config.auth);
  const port = config.port ?? 587;

  return {
    host: config.host,
    port,
    secure: config.secure ?? port === 465,
    requireTls: config.requireTls ?? false,
    auth: config.auth,
    tls: config.tls,
    connectionTimeout: config.connectionTimeout ?? 60000,
    socketTimeout: config.socketTimeout ?? 60000,
    localName: config.localName == null ? defaultLocalName() : checkLocalName(config.localName),
    localAddress: checkLocalAddress(config.localAddress),
    connect: checkConnect(config.connect),
    pool: config.pool ?? true,
    poolSize: config.poolSize ?? 5,
    dkim: config.dkim,
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
  };
};

// A host name of letters, digits and hyphens, in labels of up to 63, with a
// dot: one a server checking `reject_non_fqdn_helo_hostname` takes.
const FQDN =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * The name EHLO gives when `localName` is not set, as nodemailer finds it: the
 * host name of this machine when it is a fully qualified domain name, its
 * address as an address literal, and `[127.0.0.1]` otherwise.  A server such
 * as Postfix with `reject_non_fqdn_helo_hostname` refuses `localhost`, the
 * name upstream gave.
 *
 * @returns The name.
 * @internal
 */
const defaultLocalName = () => {
  let name;
  try {
    name = os.hostname().replace(/\.$/, '');
  } catch {
    return '[127.0.0.1]';
  }
  const family = isIP(name);
  if (family === 4) return `[${name}]`;
  if (family === 6) return `[IPv6:${name}]`;
  return FQDN.test(name) ? name : '[127.0.0.1]';
};

// The name goes into EHLO as it is, so it holds no whitespace or control
// character, which would end the command.
const checkLocalName = (name) => {
  // oxlint-disable-next-line no-control-regex -- the controls are what it refuses
  if (typeof name !== 'string' || name === '' || /[\s\0-\x1f\x7f]/.test(name)) {
    throw new TypeError(`Invalid localName: ${JSON.stringify(name)}`);
  }
  return name;
};

// `localAddress` is an address of this machine to connect from.
const checkLocalAddress = (address) => {
  if (address === undefined) return undefined;
  if (typeof address !== 'string' || isIP(address) === 0) {
    throw new TypeError(`localAddress must be an IP address: ${JSON.stringify(address)}`);
  }
  return address;
};

const checkConnect = (connect) => {
  if (connect !== undefined && typeof connect !== 'function') {
    throw new TypeError('connect must be a function that resolves to a connected socket.');
  }
  return connect;
};

// The mechanisms of each kind of credentials; an unknown one is refused when
// the transport is made rather than at the first send.
const PASSWORD_METHODS = new Set(['plain', 'login']);
const OAUTH2_METHODS = new Set(['xoauth2', 'oauthbearer']);

const checkAuthMethod = (auth) => {
  if (auth?.method == null) return;
  const methods =
    'accessToken' in auth || 'refreshToken' in auth ? OAUTH2_METHODS : PASSWORD_METHODS;
  if (!methods.has(auth.method)) {
    throw new TypeError(`Unsupported authentication method: ${auth.method}`);
  }
};

module.exports = {
  checkAuthMethod,
  checkConnect,
  checkLocalAddress,
  checkLocalName,
  createSmtpConfig,
  defaultLocalName,
};
