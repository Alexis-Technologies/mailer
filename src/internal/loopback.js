// Not ported: whether a host is this machine, the one place where
// credentials may go over plain text: SMTP AUTH without TLS, an OAuth 2.0 token
// endpoint or an HTTP provider over http:, to a local fake server.  One rule
// for all three, which upstream wrote three times, differently.

const net = require('node:net');

// 127.0.0.0/8 and ::1; BlockList also matches their IPv4-mapped IPv6 forms.
const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');

/**
 * Whether an IP address is a loopback address: one of 127.0.0.0/8 or `::1`,
 * also IPv4-mapped (`::ffff:127.0.0.1`), bracketed or with a zone.
 *
 * @param address An IPv4 or IPv6 address, such as `socket.remoteAddress`.
 * @returns `true` for a loopback address, `false` for any other text.
 * @internal
 */
const isLoopbackAddress = (address) => {
  let name = address;
  if (name.startsWith('[') && name.endsWith(']')) name = name.slice(1, -1);
  const zone = name.indexOf('%');
  if (zone !== -1) name = name.slice(0, zone);
  const family = net.isIP(name);
  if (family === 0) return false;
  return LOOPBACK.check(name, family === 4 ? 'ipv4' : 'ipv6');
};

/**
 * Whether a host is a loopback host: `localhost`, a name under `.localhost`,
 * or a loopback address.  It takes a configured host as well as the
 * `hostname` of a `URL`, whose IPv6 address is bracketed.
 *
 * @param host The host name or address.
 * @returns `true` for a loopback host.
 * @internal
 */
const isLoopbackHost = (host) => {
  const name = host.toLowerCase().replace(/\.$/, '');
  return name === 'localhost' || name.endsWith('.localhost') || isLoopbackAddress(name);
};

module.exports = { isLoopbackAddress, isLoopbackHost };
