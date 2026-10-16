// Not ported from upyo: whether a host name of a URL is this machine, the one
// place where credentials may go over plain HTTP, to a local fake server.

const net = require('node:net');

/**
 * Whether the host name of a parsed URL is a loopback host: `localhost`, a
 * name under `.localhost`, an address of 127.0.0.0/8, or `::1` (also as an
 * IPv4-mapped 127 address).  `URL` has already put the name in its canonical
 * form, so `127.1` reads `127.0.0.1` and an IPv6 address is bracketed.
 *
 * @param hostname The `hostname` of a `URL`.
 * @returns `true` for a loopback host.
 * @internal
 */
const isLoopbackHostname = (hostname) => {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (net.isIPv4(name)) return name.startsWith('127.');
  return name === '[::1]' || name.startsWith('[::ffff:7f');
};

module.exports = { isLoopbackHostname };
