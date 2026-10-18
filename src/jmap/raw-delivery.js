// Ported from upyo v0.7.0 (packages/jmap/src/raw-delivery.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { toAsciiAddress } = require('../core/address.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { RawMessageValidationError } = require('../core/raw-message.js');
const { JMAP_ERROR_TYPES, JmapApiError } = require('./errors.js');
const { JmapHttpClient } = require('./http-client.js');
const { findOnlyResponse, isRecord, rawOperation, uploadRawMessage } = require('./raw-upload.js');
const { certificateFailure } = require('../internal/refusal.js');

const using = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
  'urn:ietf:params:jmap:submission',
];

const failure = (message, stage, retryable, unknown = false, error) => {
  let category;
  if (unknown) category = 'unknown';
  else if (error?.statusCode === undefined && !retryable) category = 'rejected';
  return createFailedReceipt(message, {
    provider: 'jmap',
    code: `jmap.raw_${stage}_${unknown ? 'unknown' : 'failed'}`,
    category,
    statusCode: error?.statusCode,
    retryAfterMilliseconds: error?.retryAfterMilliseconds,
    providerDetails: error
      ? {
          responseBody: error.responseBody,
          jmapErrorType: error.jmapErrorType,
        }
      : undefined,
    retryable,
    attempts: 1,
  });
};

const methodResult = (response, name, id, accountId) => {
  if (!isRecord(response) || !Array.isArray(response.methodResponses)) {
    throw new JmapApiError('Invalid raw JMAP method response.');
  }
  const result = findOnlyResponse(response.methodResponses, id);
  if (result === undefined) {
    throw new JmapApiError('Missing or contradictory raw JMAP method response.');
  }
  if (
    !Array.isArray(result) ||
    result.length !== 3 ||
    !isRecord(result[1]) ||
    (result[0] !== name && result[0] !== 'error')
  ) {
    throw new JmapApiError('Invalid raw JMAP method result.');
  }
  if (result[0] === 'error') {
    if (typeof result[1].type !== 'string' || !result[1].type) {
      throw new JmapApiError('Invalid raw JMAP method error.');
    }
  } else if (result[1].accountId !== accountId) {
    throw new JmapApiError('Wrong account in raw JMAP response.');
  }
  return { name: result[0], args: result[1] };
};

const creation = (args) => {
  const created = isRecord(args.created) ? args.created.raw : undefined;
  const rejected = isRecord(args.notCreated) ? args.notCreated.raw : undefined;
  if (created !== undefined && rejected !== undefined) {
    throw new JmapApiError('Contradictory raw JMAP creation result.');
  }
  if (isRecord(created) && typeof created.id === 'string' && created.id) {
    return { created };
  }
  if (isRecord(rejected) && typeof rejected.type === 'string' && rejected.type) return { rejected };
  throw new JmapApiError('Missing raw JMAP creation result.');
};

const errorDescription = (error) => {
  return `Raw JMAP operation rejected: ${String(error.type)}${
    typeof error.description === 'string' ? `: ${error.description}` : ''
  }`;
};

const isRequestRejection = (error) => {
  if (!(error instanceof JmapApiError)) return false;
  // HTTP authentication failures reject the request regardless of body format.
  if (error.statusCode === 401 || error.statusCode === 403) return true;
  if (
    !error.responseBody ||
    error.statusCode === undefined ||
    error.statusCode < 400 ||
    error.statusCode > 599
  ) {
    return false;
  }
  try {
    const body = JSON.parse(error.responseBody);
    if (!isRecord(body) || (body.status !== undefined && body.status !== error.statusCode)) {
      return false;
    }
    if (body.type === JMAP_ERROR_TYPES.limit) {
      return typeof body.limit === 'string' && body.limit.length > 0;
    }
    return (
      body.type === JMAP_ERROR_TYPES.notJSON ||
      body.type === JMAP_ERROR_TYPES.notRequest ||
      body.type === JMAP_ERROR_TYPES.unknownCapability
    );
  } catch {
    return false;
  }
};

/** Uploads, imports, then submits exactly once; uncertain submission must not be retried. @internal */
const deliverRawMessage = async (
  config,
  session,
  accountId,
  draftsMailboxId,
  identityId,
  plan,
  signal,
) => {
  // Mutations must never inherit the composed transport's automatic retries.
  const client = new JmapHttpClient({ ...config, retries: 0 }, false);
  const execute = (request) =>
    rawOperation(
      config.timeout,
      (owned) => client.executeRequest(session.apiUrl, request, owned),
      signal,
    );
  let stage = 'upload';
  try {
    const uploaded = await uploadRawMessage(config, session.uploadUrl, accountId, plan, signal);
    signal?.throwIfAborted();
    stage = 'import';
    const emailId = await importRawEmail(execute, accountId, draftsMailboxId, uploaded.blobId);
    if (typeof emailId !== 'string') return emailId;
    signal?.throwIfAborted();
    stage = 'submission';
    const receipt = await submitRawEmail(execute, accountId, emailId, identityId, plan.envelope);
    if (receipt.successful) signal?.throwIfAborted();
    return receipt;
  } catch (error) {
    signal?.throwIfAborted();
    return rawDeliveryFailure(error, stage);
  }
};

/**
 * Imports the uploaded blob into the drafts mailbox, or finds the Email the
 * server already holds for it.
 *
 * @returns The id of the Email, or the receipt of a failure.
 */
const importRawEmail = async (execute, accountId, draftsMailboxId, blobId) => {
  const imported = methodResult(
    await execute({
      using,
      methodCalls: [
        [
          'Email/import',
          {
            accountId,
            emails: { raw: { blobId, mailboxIds: { [draftsMailboxId]: true } } },
          },
          'raw-import',
        ],
      ],
    }),
    'Email/import',
    'raw-import',
    accountId,
  );
  if (imported.name === 'error') {
    return failure(
      errorDescription(imported.args),
      'import',
      imported.args.type === 'serverPartialFail',
    );
  }
  const { created, rejected } = creation(imported.args);
  if (created && typeof created.id === 'string') return created.id;
  if (
    rejected?.type === 'alreadyExists' &&
    typeof rejected.existingId === 'string' &&
    rejected.existingId
  ) {
    return existingEmailId(execute, accountId, rejected.existingId, blobId);
  }
  return failure(errorDescription(rejected ?? { type: 'invalidResult' }), 'import', false);
};

// The Email the server already holds, if it is the one of the uploaded blob.
const existingEmailId = async (execute, accountId, existingId, blobId) => {
  const existing = methodResult(
    await execute({
      using,
      methodCalls: [
        [
          'Email/get',
          { accountId, ids: [existingId], properties: ['id', 'blobId'] },
          'raw-existing',
        ],
      ],
    }),
    'Email/get',
    'raw-existing',
    accountId,
  );
  const list = existing.args.list;
  if (
    existing.name === 'error' ||
    !Array.isArray(list) ||
    list.length !== 1 ||
    !isRecord(list[0]) ||
    list[0].id !== existingId ||
    list[0].blobId !== blobId
  ) {
    return failure('Existing Email does not match the uploaded raw blob.', 'import', false);
  }
  return existingId;
};

/**
 * Submits the imported Email once with the envelope of the plan.
 *
 * @returns The receipt of the submission.
 * @throws {JmapApiError} If the server answers without a submission id.
 */
const submitRawEmail = async (execute, accountId, emailId, identityId, envelope) => {
  const rcptTo = [];
  for (const email of envelope.to) rcptTo.push({ email: toAsciiAddress(email) });
  const submitted = methodResult(
    await execute({
      using,
      methodCalls: [
        [
          'EmailSubmission/set',
          {
            accountId,
            create: {
              raw: {
                emailId,
                identityId,
                envelope: { mailFrom: { email: toAsciiAddress(envelope.from ?? '') }, rcptTo },
              },
            },
          },
          'raw-submit',
        ],
      ],
    }),
    'EmailSubmission/set',
    'raw-submit',
    accountId,
  );
  if (submitted.name === 'error') {
    // RFC 8620 permits partial state changes for serverPartialFail.
    return failure(
      errorDescription(submitted.args),
      'submission',
      false,
      submitted.args.type === 'serverPartialFail',
    );
  }
  const result = creation(submitted.args);
  if (result.rejected) {
    return failure(errorDescription(result.rejected), 'submission', false);
  }
  if (!result.created || typeof result.created.id !== 'string') {
    throw new JmapApiError('Missing raw submission ID.');
  }
  return { successful: true, provider: 'jmap', messageId: result.created.id };
};

// A failure of a stage that threw: a definite rejection before submission may
// be retried, and a submission without a definite answer may have gone.
const rawDeliveryFailure = (error, stage) => {
  const message = error instanceof Error ? error.message : String(error);
  const certificate = certificateFailure('jmap', message, error);
  if (certificate !== undefined) return certificate;
  if (error instanceof RawMessageValidationError) {
    return createFailedReceipt(message, {
      provider: 'jmap',
      code: 'jmap.raw_message_invalid',
      category: 'validation',
      retryable: false,
      attempts: 1,
    });
  }
  const definite = isRequestRejection(error);
  return failure(
    message,
    stage,
    stage !== 'submission' && !definite,
    stage === 'submission' && !definite,
    error instanceof JmapApiError ? error : undefined,
  );
};

/** Validates raw discovery responses before accepting delivery identifiers. @internal */
const rawDiscoveryResult = (response, method, accountId) => {
  const result = methodResult(response, method, 'c0', accountId);
  if (result.name === 'error') {
    throw new JmapApiError(errorDescription(result.args));
  }
  return result.args;
};

module.exports = { deliverRawMessage, rawDiscoveryResult };
