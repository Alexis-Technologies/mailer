// Ported from upyo v0.7.0 (packages/mime/src/dkim/types.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { domainToASCII } = require('node:url');

/**
 * Validates the runtime body-mode option without changing config identity.
 * @param config Optional signing configuration.
 * @throws {TypeError} If the body mode is unsupported.
 */
const validateDkimBodyMode = (config) => {
  if (
    config?.bodyMode !== undefined &&
    config.bodyMode !== 'buffered' &&
    config.bodyMode !== 'streaming'
  ) {
    throw new TypeError('Expected DKIM bodyMode to be buffered or streaming.');
  }
};

// The tags that go into the DKIM-Signature field as they are.  A domain or a
// selector is dot-separated labels of letters, digits and hyphens (RFC 6376
// §3.5, sub-domain of RFC 5321), in A-labels once converted, since RFC 8616
// lets an internationalized message carry U-labels; a header field name is printable ASCII
// without the ":" that ends it, nor the ";" that would end the h= tag.  Any
// other character could end a tag early or, with a line break, add a field.
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const FIELD_NAME = /^[!-9<-~]+$/;
const ALGORITHMS = new Set(['rsa-sha256', 'ed25519-sha256']);
const CANONICALIZATIONS = new Set([
  'relaxed/relaxed',
  'relaxed/simple',
  'simple/relaxed',
  'simple/simple',
]);

// domainToASCII is a WHATWG host parser: it removes tabs, CR and LF before
// it reads a name, cuts it at "/", "?" or "#" and percent-decodes it, so
// "exa\r\nmple.com" came back as the valid "example.com" while the name,
// line break and all, went into the DKIM-Signature field as given.
// oxlint-disable-next-line no-control-regex -- the controls are what it finds
const URL_PARSER_UNSAFE = /[/\\?#%\x00-\x20\x7f]/;

const isDomainName = (value) => {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (URL_PARSER_UNSAFE.test(value)) return false;
  // domainToASCII gives '' for a name it cannot convert, such as one with a
  // semicolon.
  const ascii = domainToASCII(value);
  if (ascii.length === 0 || ascii.length > 253) return false;
  for (const label of ascii.split('.')) {
    if (!LABEL.test(label)) return false;
  }
  return true;
};

/**
 * Checks a DKIM configuration: its body mode, and in each signature the
 * domain (`d=`), the selector (`s=`), the algorithm, the canonicalization
 * and the names of the signed fields, which all go into the signature field.
 *
 * @param config Optional signing configuration.
 * @throws {TypeError} If any of them is not valid.
 */
const checkDkimConfig = (config) => {
  validateDkimBodyMode(config);
  if (config == null) return;
  if (!Array.isArray(config.signatures)) refuse('signatures', config.signatures);
  for (const signature of config.signatures) {
    if (!isDomainName(signature.signingDomain)) refuse('signing domain', signature.signingDomain);
    if (!isDomainName(signature.selector)) refuse('selector', signature.selector);
    const { algorithm, canonicalization, headerFields } = signature;
    if (algorithm !== undefined && !ALGORITHMS.has(algorithm)) refuse('algorithm', algorithm);
    if (canonicalization !== undefined && !CANONICALIZATIONS.has(canonicalization)) {
      refuse('canonicalization', canonicalization);
    }
    for (const field of headerFields ?? []) {
      if (typeof field !== 'string' || !FIELD_NAME.test(field)) refuse('header field', field);
    }
  }
};

const refuse = (what, value) => {
  throw new TypeError(`Invalid DKIM ${what}: ${JSON.stringify(value)}.`);
};

/**
 * Default header fields to sign if not specified: those a reader trusts or a
 * client renders, present or not, since a field absent when signed cannot be
 * added afterwards without breaking the signature.  The two of one-click
 * unsubscription are among them, as RFC 8058 §4 asks.  From, Reply-To and
 * Subject are listed once more than they can appear, so that a second
 * instance cannot be added either (over-signing, RFC 6376 §8.15).
 */
const DEFAULT_SIGNED_HEADERS = [
  'from',
  'from',
  'reply-to',
  'reply-to',
  'subject',
  'subject',
  'to',
  'cc',
  'date',
  'message-id',
  'in-reply-to',
  'references',
  'mime-version',
  'content-type',
  'list-unsubscribe',
  'list-unsubscribe-post',
];

/**
 * Default DKIM algorithm.
 */
const DEFAULT_ALGORITHM = 'rsa-sha256';

/**
 * Default canonicalization method.
 */
const DEFAULT_CANONICALIZATION = 'relaxed/relaxed';

module.exports = {
  checkDkimConfig,
  validateDkimBodyMode,
  DEFAULT_SIGNED_HEADERS,
  DEFAULT_ALGORITHM,
  DEFAULT_CANONICALIZATION,
};
