// Not ported: whether a URL leads to a public address, which a request of
// the library to a URL it was given checks first: an attachment of
// ./attachments (fixes N2 and R3) and the endpoint of a subscription of Web
// Push, which a browser gives and anyone may forge.

const net = require('node:net');

// The addresses no request of the library to a URL it was given goes to: this
// network, the private ranges, CGNAT, loopback, link-local (where cloud
// metadata answers), the ranges of the IETF protocol assignments, benchmarking
// and documentation, multicast and the reserved block (the broadcast address
// among them); and in IPv6 the unspecified and loopback addresses with the
// whole of ::/96 (IPv4-compatible, deprecated), unique local, link-local,
// site-local (deprecated) and multicast.  An address of NAT64 or 6to4 embeds an
// IPv4 address that a gateway on the way may reach, a private one included, so
// their prefixes are refused whole.  BlockList matches IPv4-mapped IPv6 forms
// against the IPv4 rules.
const PRIVATE = new net.BlockList();
PRIVATE.addSubnet('0.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.0.0.0', 24, 'ipv4');
PRIVATE.addSubnet('192.0.2.0', 24, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('198.18.0.0', 15, 'ipv4');
PRIVATE.addSubnet('198.51.100.0', 24, 'ipv4');
PRIVATE.addSubnet('203.0.113.0', 24, 'ipv4');
PRIVATE.addSubnet('224.0.0.0', 4, 'ipv4');
PRIVATE.addSubnet('240.0.0.0', 4, 'ipv4');
PRIVATE.addSubnet('::', 96, 'ipv6');
PRIVATE.addSubnet('64:ff9b::', 96, 'ipv6');
PRIVATE.addSubnet('64:ff9b:1::', 48, 'ipv6');
PRIVATE.addSubnet('2002::', 16, 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');
PRIVATE.addSubnet('fec0::', 10, 'ipv6');
PRIVATE.addSubnet('ff00::', 8, 'ipv6');

const hostOf = (url) => {
  let host = url.hostname.toLowerCase();
  if (host.startsWith('[')) host = host.slice(1, -1);
  return host.endsWith('.') ? host.slice(0, -1) : host;
};

const isPrivateAddress = (address, family) =>
  PRIVATE.check(address, family === 6 || family === 'IPv6' ? 'ipv6' : 'ipv4');

/**
 * The check of the host of a URL as written, the first of those `fromUrl`
 * makes when no `allowUrl` is given, and that of the endpoint of Web Push: no `localhost`, and no IP literal in a loopback, private,
 * link-local, multicast, reserved or documentation range, or in an IPv6 range
 * that carries an IPv4 address (IPv4-compatible, NAT64, 6to4).  The URL parser
 * has already written an address such as `0x7f.1` or `2130706433` as
 * `127.0.0.1`.
 *
 * It resolves no name: `fromUrl`, when no `allowUrl` is given, also checks
 * every address a host name resolves to, but a name that answers the fetch
 * otherwise than it answered the check (DNS rebinding) passes.  A sender that
 * fetches URLs its users give passes a `fetch` that checks the address it
 * connects to.
 *
 * @param url The URL to fetch.
 * @returns Whether to fetch it.
 */
const isPublicUrl = (url) => {
  const host = hostOf(url);
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  const family = net.isIP(host);
  return family === 0 || !isPrivateAddress(host, family);
};

/**
 * The check `fromUrl` makes when no `allowUrl` is given: `isPublicUrl`, then
 * every address a host name resolves to, so that a name of a private address
 * (`127.0.0.1.nip.io`, `metadata.google.internal`) is refused as its address
 * is.  A name that answers the fetch otherwise than it answered here (DNS
 * rebinding) is caught only by a `fetch` that checks the address it connects
 * to.
 *
 * @param url The URL.
 * @param lookup `dns.promises.lookup`, or one of the application's.
 * @returns Whether to request it.
 * @internal
 */
const resolvesPublic = async (url, lookup) => {
  if (!isPublicUrl(url)) return false;
  const host = hostOf(url);
  if (net.isIP(host) !== 0) return true;
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) return false;
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address, entry.family)) return false;
  }
  return true;
};

module.exports = { isPublicUrl, resolvesPublic };
