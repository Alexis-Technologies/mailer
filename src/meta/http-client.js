// Ported from @thinwrap/notifications v1.2.0 (src/providers/whatsapp-business/whatsapp-business.connector.ts):
// the request of messages of the WhatsApp Cloud API and `mapWhatsAppCode`,
// the codes of its errors.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: through the shared client of the HTTP providers, so a
// redirect is not followed, the body is bounded, and a send is never retried
// after a lost answer; the codes of the channels have categories of their
// own (a recipient not on WhatsApp is `not-on-channel`, a message outside the
// 24-hour window `outside-window`, a user who stopped marketing `opted-out`)
// where thinwrap made them invalid requests or invalid recipients; and the
// Send API of Messenger and Instagram shares the client, with its codes.

const { createApiClient } = require('../internal/api-client.js');

// What a code of the Graph API says, of WhatsApp and of the Send API.
const CODES = new Map([
  [131026, 'not-on-channel'],
  [131047, 'outside-window'],
  [131050, 'opted-out'],
  [131021, 'invalid-recipient'],
  [131049, 'rejected'],
  [551, 'blocked'],
  [0, 'auth'],
  [190, 'auth'],
  [131005, 'auth'],
  [3, 'configuration'],
  [10, 'configuration'],
  [368, 'configuration'],
  [131031, 'configuration'],
  [131042, 'configuration'],
  [131045, 'configuration'],
  [133010, 'configuration'],
  [4, 'rate-limit'],
  [613, 'rate-limit'],
  [80007, 'rate-limit'],
  [130429, 'rate-limit'],
  [131048, 'rate-limit'],
  [131056, 'rate-limit'],
  [1, 'service-unavailable'],
  [2, 'service-unavailable'],
  [131000, 'service-unavailable'],
  [131016, 'service-unavailable'],
  [131057, 'service-unavailable'],
]);
// The subcodes of the Send API that say more than their code.
const SUBCODES = new Map([
  [2018278, 'outside-window'],
  [2018109, 'outside-window'],
  [2018001, 'invalid-recipient'],
  [1545041, 'blocked'],
  [2018108, 'blocked'],
]);
const RETRYABLE = new Set(['rate-limit', 'service-unavailable']);

/**
 * The category of an error of the Graph API: by its subcode, its code (the
 * permissions 200 to 299 are `configuration`, the parameters 100 and 131008
 * to 132999 `validation`), then its status.
 *
 * @internal
 */
const classifyMeta = (status, json) => {
  const error = json?.error;
  const code = typeof error?.code === 'number' ? error.code : undefined;
  const subcode = typeof error?.error_subcode === 'number' ? error.error_subcode : undefined;
  let category = SUBCODES.get(subcode) ?? CODES.get(code);
  if (category === undefined && code !== undefined) {
    if (code >= 200 && code <= 299) category = 'configuration';
    else if (code === 100 || (code >= 131008 && code <= 132999)) category = 'validation';
  }
  if (category === undefined) {
    if (status === 401) category = 'auth';
    else if (status === 403) category = 'configuration';
    else if (status === 429) category = 'rate-limit';
    else if (status >= 500) category = 'service-unavailable';
    else if (status >= 400) category = 'validation';
    else return undefined;
  }
  const codeOf = subcode === undefined ? `${code ?? `http_${status}`}` : `${code}.${subcode}`;
  return { category, retryable: RETRYABLE.has(category), code: `meta.${codeOf}` };
};

/**
 * The client of the Graph API: the messages of a number, a page or an
 * account, each with its token.
 *
 * @internal
 */
const createMetaClient = (config) => {
  // The token of the request, set by the channel that sends it.
  const client = createApiClient(config, {
    id: 'meta',
    label: 'Meta',
    authorize: (headers) => {
      if (!headers.has('authorization')) throw new Error('Meta: a request without its token.');
    },
    messageOf: (json) =>
      typeof json?.error?.message === 'string' ? json.error.message : undefined,
    classify: classifyMeta,
  });
  const nodeUrl = (id) => `${config.baseUrl}/${config.graphVersion}/${id}`;
  return {
    ...client,
    nodeUrl,
    /** Sends the messages of the block of a channel. */
    send: (block, body, options) =>
      client.request({
        url: `${nodeUrl(block.id)}/messages`,
        body,
        headers: { Authorization: `Bearer ${block.accessToken}` },
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifyMeta, createMetaClient };
