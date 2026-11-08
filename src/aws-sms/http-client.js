// Not ported: the client of AWS End User Messaging SMS
// (https://docs.aws.amazon.com/pinpoint/latest/apireference_smsvoicev2/API_SendTextMessage.html),
// the JSON protocol of AWS signed with SigV4 at each attempt, and the
// categories of its errors by their type and reason: a number opted out is
// `opted-out`, a destination not verified in the sandbox `configuration`.

const { untilAborted } = require('../internal/until-aborted.js');
const { createApiClient } = require('../internal/api-client.js');
const { createSigV4Signer } = require('../internal/sigv4.js');

const SERVICE = 'sms-voice';
const TARGET = 'PinpointSMSVoiceV2';
// The reasons of an error that say more than its type.
const REASONS = new Map([
  ['DESTINATION_PHONE_NUMBER_OPTED_OUT', 'opted-out'],
  ['DESTINATION_PHONE_NUMBER_NOT_VERIFIED', 'configuration'],
  ['DESTINATION_COUNTRY_BLOCKED', 'configuration'],
  ['INVALID_PHONE_NUMBER', 'invalid-recipient'],
  ['INVALID_IDENTITY_FOR_DESTINATION_COUNTRY', 'configuration'],
  ['MONTHLY_SPEND_LIMIT_REACHED_FOR_TEXT', 'configuration'],
  ['ACCOUNT_DISABLED', 'auth'],
]);
// The types of an error of the AWS JSON protocol.
const TYPES = new Map([
  ['ValidationException', 'validation'],
  ['ConflictException', 'validation'],
  ['ResourceNotFoundException', 'configuration'],
  ['AccessDeniedException', 'auth'],
  ['UnrecognizedClientException', 'auth'],
  ['InvalidSignatureException', 'auth'],
  ['ExpiredTokenException', 'auth'],
  ['ThrottlingException', 'rate-limit'],
  ['ServiceQuotaExceededException', 'rate-limit'],
  ['InternalServerException', 'server-error'],
]);
const RETRYABLE = new Set(['rate-limit', 'server-error']);

// The type of an error: the end of its `__type` (`com.amazonaws…#Throttling`).
const typeOf = (json, headers) => {
  // oxlint-disable-next-line no-underscore-dangle -- the field of the AWS JSON protocol
  const raw = json?.__type ?? headers.get('x-amzn-errortype') ?? '';
  const name = String(raw).split(':')[0];
  return name.slice(name.lastIndexOf('#') + 1);
};

/**
 * The category of an error of the SMS API of AWS.
 *
 * @internal
 */
const classifyAwsSms = (status, json, headers) => {
  const type = typeOf(json, headers);
  const reason = typeof json?.Reason === 'string' ? json.Reason : undefined;
  const category =
    REASONS.get(reason) ?? TYPES.get(type) ?? (status >= 500 ? 'server-error' : undefined);
  if (category === undefined) return undefined;
  return {
    category,
    retryable: RETRYABLE.has(category),
    code: `aws-sms.${reason ?? (type || `http_${status}`)}`,
  };
};

/**
 * The client of the SMS API, each attempt signed anew.
 *
 * @internal
 */
const createAwsSmsClient = (config) => {
  const sign = createSigV4Signer(config.region, SERVICE);
  const client = createApiClient(config, {
    id: 'aws-sms',
    label: 'AWS SMS',
    authorize: async (headers, request) => {
      // A provider of credentials that hangs ends with the attempt.
      const credentials =
        typeof config.credentials === 'function'
          ? await untilAborted(Promise.resolve().then(config.credentials), request.signal)
          : config.credentials;
      const signed = sign(
        request.url,
        { method: request.method, headers, body: request.body },
        credentials,
      );
      for (const [name, value] of signed) headers.set(name, value);
    },
    messageOf: (json) => {
      const message = json?.Message ?? json?.message;
      return typeof message === 'string' ? message : undefined;
    },
    classify: classifyAwsSms,
  });
  const call = (action, body, options) =>
    client.request({
      url: `${config.baseUrl}/`,
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'X-Amz-Target': `${TARGET}.${action}`,
      },
      signal: options?.signal,
      onRetry: options?.onRetry,
      isIdempotent: options?.isIdempotent === true,
    });
  return { ...client, call };
};

module.exports = { classifyAwsSms, createAwsSmsClient };
