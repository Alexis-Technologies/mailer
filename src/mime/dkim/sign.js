// Ported from upyo v0.7.0 (packages/mime/src/dkim/sign.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * DKIM Signing implementation per RFC 6376.
 *
 * Uses Web Crypto API for cross-runtime compatibility.
 *
 * @see https://www.rfc-editor.org/rfc/rfc6376
 */

const { createPrivateKey } = require('node:crypto');
const {
  canonicalizeBodyRelaxed,
  canonicalizeBodySimple,
  canonicalizeHeaderRelaxed,
  canonicalizeHeaderSimple,
} = require('./canonicalize.js');
const {
  DEFAULT_ALGORITHM,
  DEFAULT_CANONICALIZATION,
  DEFAULT_SIGNED_HEADERS,
} = require('./types.js');

/**
 * Signs a raw email message with DKIM.
 *
 * @param rawMessage - The complete raw email message (headers + body)
 * @param config - DKIM signature configuration
 * @param signal Optional cancellation signal.
 * @returns The DKIM-Signature header result
 * @throws Error if signing fails (e.g., invalid private key)
 */
const signMessage = async (rawMessage, config, signal) => {
  signal?.throwIfAborted();
  const { body } = parseMessage(rawMessage);
  const bodyCanon = (config.canonicalization ?? DEFAULT_CANONICALIZATION).endsWith('/simple')
    ? 'simple'
    : 'relaxed';
  const bodyHash = await computeBodyHash(body, bodyCanon);
  return await signWithBodyHash(rawMessage, config, bodyHash, signal);
};

/**
 * Signs frozen headers using a body hash computed by the MIME reader.
 * @param rawHeaders Frozen wire headers, including earlier signatures.
 * @param config Signature configuration.
 * @param bodyHash Canonical body SHA-256 digest, encoded as base64.
 * @param signal Optional cancellation signal.
 * @returns A DKIM-Signature header value.
 * @throws {Error} If key import, signing, or cancellation fails.
 */
const signWithBodyHash = async (rawHeaders, config, bodyHash, signal) => {
  signal?.throwIfAborted();
  const algorithm = config.algorithm ?? DEFAULT_ALGORITHM;
  const canonicalization = config.canonicalization ?? DEFAULT_CANONICALIZATION;
  const headerFields = config.headerFields ?? DEFAULT_SIGNED_HEADERS;

  // Parse the raw message into headers and body
  const { headers } = parseMessage(rawHeaders);

  // Determine canonicalization methods
  const [headerCanon] = canonicalization.split('/');

  // Get or import the private key
  const privateKey = await getPrivateKey(config.privateKey, algorithm);

  signal?.throwIfAborted();

  // Build the DKIM-Signature header value (without b= value)
  const dkimHeaderValue = buildDkimHeaderValue({
    algorithm,
    canonicalization,
    signingDomain: config.signingDomain,
    selector: config.selector,
    headerFields,
    bodyHash,
  });

  // Compute the signature
  const signatureData = buildSignatureData(headers, headerFields, headerCanon, dkimHeaderValue);

  const signature = await signData(signatureData, privateKey, algorithm);
  signal?.throwIfAborted();

  // Return the complete DKIM-Signature header
  return {
    headerName: 'DKIM-Signature',
    signature: `${dkimHeaderValue} b=${signature}`,
  };
};

/**
 * Parses a raw email message into headers and body.
 */
const parseMessage = (rawMessage) => {
  // Find the separator between headers and body (empty line)
  const separatorIndex = rawMessage.indexOf('\r\n\r\n');
  if (separatorIndex === -1) {
    // No body, all headers
    return {
      headers: parseHeaders(rawMessage),
      body: '',
    };
  }

  const headerSection = rawMessage.substring(0, separatorIndex);
  const body = rawMessage.substring(separatorIndex + 4); // Skip \r\n\r\n

  return {
    headers: parseHeaders(headerSection),
    body,
  };
};

/**
 * Parses header section into a map from the lower-case name of a field to
 * its instances, top to bottom.  Handles folded headers (continuation lines).
 */
const parseHeaders = (headerSection) => {
  const headers = new Map();
  const lines = headerSection.split('\r\n');

  let currentName = '';
  let currentValue = '';
  const save = () => {
    const key = currentName.toLowerCase();
    const instances = headers.get(key);
    const field = { name: currentName, value: currentValue };
    if (instances === undefined) headers.set(key, [field]);
    else instances.push(field);
  };

  for (const line of lines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      // Continuation of previous header (folded)
      currentValue += '\r\n' + line;
    } else {
      // New header - save previous if exists
      if (currentName) save();

      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        currentName = line.substring(0, colonIndex);
        currentValue = line.substring(colonIndex + 1);
      }
    }
  }

  // Save the last header
  if (currentName) save();

  return headers;
};

// Imported keys by the signature configuration that holds their PEM: a key is
// parsed and imported once per configuration rather than once per message, and
// goes with the configuration.
const importedKeys = new WeakMap();

/**
 * Gives the private key of a signature configuration: its CryptoKey, or the
 * import of its PEM, started once per configuration object and algorithm.
 *
 * @param signature A signature configuration of the caller.
 * @returns A CryptoKey, or a promise of the imported one.
 * @internal
 */
const resolvePrivateKey = (signature) => {
  const key = signature.privateKey;
  if (typeof key !== 'string') return key;
  const algorithm = signature.algorithm ?? DEFAULT_ALGORITHM;
  let cached = importedKeys.get(signature);
  if (cached === undefined || cached.pem !== key || cached.algorithm !== algorithm) {
    const imported = importPrivateKey(key, algorithm);
    const entry = { pem: key, algorithm, imported };
    importedKeys.set(signature, entry);
    // A failed import is tried again with the next message.
    imported.catch(() => {
      if (importedKeys.get(signature) === entry) importedKeys.delete(signature);
    });
    cached = entry;
  }
  return cached.imported;
};

/**
 * Checks, once and synchronously, that each PEM key of a configuration can be
 * read, so that a broken key fails when a transport is made rather than at
 * its first message.  A configuration that sends unsigned on a signing
 * failure is left to do so.
 *
 * @param config Optional signing configuration.
 * @throws {TypeError} If a PEM key cannot be read.
 * @internal
 */
const checkDkimKeys = (config) => {
  if (config == null || config.onSigningFailure === 'send-unsigned') return;
  for (const signature of config.signatures) {
    if (typeof signature.privateKey !== 'string') continue;
    try {
      createPrivateKey(signature.privateKey);
    } catch (error) {
      throw new TypeError(
        `Invalid DKIM private key for ${signature.signingDomain}: ${error.message}`,
        { cause: error },
      );
    }
  }
};

/**
 * Gets the private key, either using a provided CryptoKey or importing from PEM.
 */
const getPrivateKey = (key, algorithm) => {
  if (typeof key !== 'string') {
    // Already a CryptoKey, use it directly
    return key;
  }
  return importPrivateKey(key, algorithm);
};

/**
 * Imports a PEM-encoded private key for use with Web Crypto API.  The PEM is
 * read by node:crypto, which takes PKCS#8 (`BEGIN PRIVATE KEY`) and PKCS#1
 * (`BEGIN RSA PRIVATE KEY`) alike, and handed to Web Crypto as PKCS#8.
 */
const importPrivateKey = async (pem, algorithm) => {
  try {
    const bytes = createPrivateKey(pem).export({ type: 'pkcs8', format: 'der' });

    // Determine the algorithm parameters based on DKIM algorithm
    const keyAlgorithm =
      algorithm === 'ed25519-sha256'
        ? { name: 'Ed25519' }
        : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

    return await crypto.subtle.importKey('pkcs8', bytes, keyAlgorithm, false, ['sign']);
  } catch (error) {
    throw new Error(
      `Failed to import private key: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
};

/**
 * Computes the body hash (bh= tag value).
 */
const computeBodyHash = async (body, canonMethod) => {
  // Canonicalize the body
  const canonicalBody =
    canonMethod === 'relaxed' ? canonicalizeBodyRelaxed(body) : canonicalizeBodySimple(body);

  // Hash with SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalBody);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Base64 encode
  return arrayBufferToBase64(hashBuffer);
};

/**
 * Builds the DKIM-Signature header value without the b= signature.
 */
const buildDkimHeaderValue = (params) => {
  const parts = [
    'v=1',
    `a=${params.algorithm}`,
    `c=${params.canonicalization}`,
    `d=${params.signingDomain}`,
    `s=${params.selector}`,
    `h=${params.headerFields.join(':')}`,
    `bh=${params.bodyHash};`,
  ];

  return parts.join('; ');
};

/**
 * Builds the data to be signed (canonicalized headers + DKIM-Signature header).
 */
const buildSignatureData = (headers, headerFields, canonMethod, dkimHeaderValue) => {
  const lines = [];

  // RFC 6376 §5.4.2: each name in h= signs the next instance of that field
  // from the bottom up, and one with no instance left signs nothing, which
  // keeps another instance from being added (over-signing).
  const nextInstance = new Map();
  for (const field of headerFields) {
    const key = field.toLowerCase();
    const instances = headers.get(key);
    const index = nextInstance.get(key) ?? (instances === undefined ? -1 : instances.length - 1);
    nextInstance.set(key, index - 1);
    const header = index >= 0 ? instances[index] : undefined;
    if (header !== undefined) {
      const canonicalized =
        canonMethod === 'relaxed'
          ? canonicalizeHeaderRelaxed(header.name, header.value)
          : canonicalizeHeaderSimple(header.name, header.value);
      lines.push(canonicalized);
    }
  }

  // Add the DKIM-Signature header itself (without trailing CRLF)
  // The b= tag should be empty for signing
  const dkimHeader =
    canonMethod === 'relaxed'
      ? canonicalizeHeaderRelaxed('DKIM-Signature', ' ' + dkimHeaderValue + ' b=')
      : canonicalizeHeaderSimple('DKIM-Signature', ' ' + dkimHeaderValue + ' b=');

  lines.push(dkimHeader);

  // Join with CRLF (no trailing CRLF on last header per RFC 6376)
  return lines.join('\r\n');
};

/**
 * Signs data using the appropriate algorithm.
 */
const signData = async (data, privateKey, algorithm) => {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);

  // Determine the signing algorithm based on DKIM algorithm
  const signAlgorithm = algorithm === 'ed25519-sha256' ? 'Ed25519' : 'RSASSA-PKCS1-v1_5';

  // RFC 8463 uses PureEd25519 over the SHA-256 header hash. RSA hashes
  // internally through its imported key algorithm.
  const signingInput =
    algorithm === 'ed25519-sha256' ? await crypto.subtle.digest('SHA-256', dataBuffer) : dataBuffer;

  const signature = await crypto.subtle.sign(signAlgorithm, privateKey, signingInput);

  return arrayBufferToBase64(signature);
};

/**
 * Converts an ArrayBuffer to a Base64 string.
 */
const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

module.exports = { checkDkimKeys, resolvePrivateKey, signMessage, signWithBodyHash };
