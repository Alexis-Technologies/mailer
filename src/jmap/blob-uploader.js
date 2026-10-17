// Ported from upyo v0.7.0 (packages/jmap/src/blob-uploader.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { JmapApiError } = require('./errors.js');
const { readJson, readText } = require('../internal/body.js');
const { Buffer } = require('node:buffer');

/**
 * Upload a blob to the JMAP server.
 *
 * @param config - The resolved JMAP configuration
 * @param uploadUrl - The upload URL template from the session (e.g., "https://server/upload/{accountId}")
 * @param accountId - The account ID to upload to
 * @param blob - The blob or file to upload
 * @param signal - Optional abort signal
 * @returns The upload response containing the blobId
 */
const uploadBlob = async (config, uploadUrl, accountId, blob, signal) => {
  signal?.throwIfAborted();

  const url = uploadUrl.replace('{accountId}', encodeURIComponent(accountId));

  let authHeader;
  if (config.bearerToken) {
    authHeader = `Bearer ${config.bearerToken}`;
  } else if (config.basicAuth) {
    const { username, password } = config.basicAuth;
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    authHeader = `Basic ${credentials}`;
  } else {
    throw new Error('No authentication method configured');
  }

  const headers = {
    Authorization: authHeader,
    'Content-Type': blob.type || 'application/octet-stream',
  };

  // Add custom headers from config
  for (const [key, value] of Object.entries(config.headers)) {
    headers[key] = value;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  // Combine signals if an external signal is provided
  const combinedSignal = combineSignals(controller.signal, signal);

  try {
    // A redirect comes back as a response rather than being followed, so the
    // credentials in the headers never reach another origin.
    const response = await (config.fetch ?? globalThis.fetch)(url, {
      method: 'POST',
      headers,
      body: blob,
      signal: combinedSignal.signal,
      redirect: 'manual',
    });

    if (!response.ok) {
      const body = await readText(response);
      throw new JmapApiError(
        `Blob upload failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    const result = await readJson(response);
    return result;
  } finally {
    combinedSignal.cleanup();
    clearTimeout(timeoutId);
  }
};

module.exports = { uploadBlob };
