// Ported from upyo v0.7.0 (packages/jmap/src/jmap-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { createRawMessagePlan, RawMessageValidationError } = require('../core/raw-message.js');
const { deliverRawMessage, rawDiscoveryResult } = require('./raw-delivery.js');
const { isRecord, rawOperation } = require('./raw-upload.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { uploadBlob } = require('./blob-uploader.js');
const { createJmapConfig } = require('./config.js');
const { JmapApiError } = require('./errors.js');
const { JmapHttpClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');
const { findMailAccount } = require('./session.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');

/**
 * JMAP capabilities required for email sending.
 */
const JMAP_CAPABILITIES = {
  core: 'urn:ietf:params:jmap:core',
  mail: 'urn:ietf:params:jmap:mail',
  submission: 'urn:ietf:params:jmap:submission',
};

/**
 * JMAP transport for sending emails via JMAP protocol (RFC 8620/8621).
 */
class JmapTransport {
  id = 'jmap';

  config;
  httpClient;
  cachedSession = null;

  /**
   * Creates a new JMAP transport instance.
   * @param config The JMAP transport configuration.
   */
  constructor(config) {
    this.config = createJmapConfig(config);
    this.httpClient = new JmapHttpClient(this.config);
  }

  /**
   * Leaves the credentials of the configuration out of `JSON.stringify()`.
   *
   * @returns A plain copy of the transport with its credentials redacted.
   */
  toJSON() {
    return redactSecrets(this);
  }

  /**
   * Leaves the credentials of the configuration out of `util.inspect()`, and
   * so out of `console.log()` and of loggers that inspect what they log.
   */
  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Checks a fresh Session, the account used by send(), its drafts mailbox,
   * and the configured or available identity without creating or sending mail.
   * Does not read or update the session cache. Each discovery operation has
   * config.timeout as its total budget, including response bodies and retries.
   * Success does not guarantee acceptance of a particular sender or message.
   * @param options Optional cancellation signal.
   * @returns A promise that resolves when live verification succeeds.
   * @throws {JmapApiError} If discovery, authentication, or validation fails.
   * @throws The caller's abort reason if cancelled.
   */
  async verify(options) {
    const signal = options?.signal;
    signal?.throwIfAborted();
    try {
      let session = await verificationOperation(
        this.config.timeout,
        (owned) => this.httpClient.fetchSession(owned),
        signal,
      );
      validateVerificationSession(session);
      if (this.config.baseUrl) session = this.rewriteSessionUrls(session);
      validateVerificationApiUrl(session.apiUrl);
      if (!Object.values(JMAP_CAPABILITIES).every((cap) => cap in session.capabilities)) {
        throw new JmapApiError('JMAP session lacks core, mail, or submission capability.');
      }
      const accountId = this.config.accountId ?? findMailAccount(session);
      const account = accountId == null ? undefined : session.accounts[accountId];
      if (accountId == null || account == null) {
        throw new JmapApiError(`No JMAP mail account found: ${accountId ?? 'automatic selection'}`);
      }
      if (
        account.isReadOnly ||
        !(JMAP_CAPABILITIES.mail in account.accountCapabilities) ||
        !(JMAP_CAPABILITIES.submission in account.accountCapabilities)
      ) {
        throw new JmapApiError(
          `JMAP account must be writable with mail and submission capability: ${accountId}`,
        );
      }
      // oxlint-disable-next-line no-shadow -- upstream
      const get = async (method, args, signal) => {
        const response = await verificationOperation(
          this.config.timeout,
          (owned) =>
            this.httpClient.executeRequest(
              session.apiUrl,
              {
                using:
                  method === 'Mailbox/get'
                    ? [JMAP_CAPABILITIES.core, JMAP_CAPABILITIES.mail]
                    : [JMAP_CAPABILITIES.core, JMAP_CAPABILITIES.submission],
                methodCalls: [[method, { accountId, ...args }, 'verify']],
              },
              owned,
            ),
          signal,
        );
        return verificationResult(response, method, accountId);
      };
      const mailboxes = await get('Mailbox/get', { properties: ['id', 'role'] }, signal);
      if (!mailboxes.list.some((mailbox) => mailbox.role === 'drafts')) {
        throw new JmapApiError(`No drafts mailbox found in JMAP account: ${accountId}`);
      }
      const identityId = this.config.identityId;
      const identities = await get(
        'Identity/get',
        {
          ids: identityId == null ? null : [identityId],
          properties: ['id', 'email'],
        },
        signal,
      );
      if (
        identities.notFound.length > 0 ||
        identities.list.length === 0 ||
        !identities.list.every(
          (identity) => typeof identity.email === 'string' && identity.email.length > 0,
        ) ||
        (identityId != null &&
          (identities.list.length !== 1 || identities.list[0].id !== identityId))
      ) {
        throw new JmapApiError(`No valid JMAP identity found: ${identityId ?? accountId}`);
      }
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof JmapApiError) throw error;
      throw new JmapApiError(
        `JMAP verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Sends a single email message.
   * @param message The message to send.
   * @param options Optional transport options.
   * @returns A receipt indicating success or failure.
   * @throws The abort reason or an `AbortError` when the caller aborts the
   *         operation.
   */
  async send(message, options) {
    const signal = options?.signal;
    signal?.throwIfAborted();

    try {
      // Get or refresh session
      const session = await this.getSession(signal);
      signal?.throwIfAborted();

      // Get account ID
      const accountId = this.config.accountId ?? findMailAccount(session);
      if (!accountId) {
        return createJmapFailure('No mail-capable account found in JMAP session', undefined, {
          category: 'configuration',
          code: 'jmap.no_mail_account',
          retryable: false,
        });
      }

      // Get drafts mailbox ID
      const draftsMailboxId = await this.getDraftsMailboxId(session, accountId, signal);
      signal?.throwIfAborted();

      // Get identity ID
      const identityId = await this.getIdentityId(
        session,
        accountId,
        message.sender.address,
        signal,
      );
      signal?.throwIfAborted();

      // Upload attachments
      const uploadedBlobs = await this.uploadAttachments(
        session,
        accountId,
        message.attachments,
        signal,
      );
      signal?.throwIfAborted();

      // Convert message and send
      const emailCreate = convertMessage(message, draftsMailboxId, uploadedBlobs);

      // Execute Email/set + EmailSubmission/set batch request
      const response = await this.httpClient.executeRequest(
        session.apiUrl,
        {
          using: [JMAP_CAPABILITIES.core, JMAP_CAPABILITIES.mail, JMAP_CAPABILITIES.submission],
          methodCalls: [
            [
              'Email/set',
              {
                accountId,
                create: { draft: emailCreate },
              },
              'c0',
            ],
            [
              'EmailSubmission/set',
              {
                accountId,
                create: {
                  submission: {
                    identityId,
                    emailId: '#draft',
                  },
                },
              },
              'c1',
            ],
          ],
        },
        signal,
      );

      // Parse response
      return this.parseResponse(response);
    } catch (error) {
      if (signal?.aborted) {
        throw getAbortReason(signal, error);
      }

      if (error instanceof Error && error.name === 'AbortError') {
        return createJmapFailure(`Request aborted: ${error.message}`, error, {
          category: 'timeout',
          code: 'abort',
          retryable: true,
        });
      }

      if (error instanceof JmapApiError) {
        return createJmapFailure(error.message, error);
      }

      return createJmapFailure(error instanceof Error ? error.message : String(error), error);
    }
  }

  /**
   * Uploads serialized MIME, imports it, and submits it with an explicit envelope.
   * JMAP servers may modify imported or submitted messages, including removing
   * Bcc. Import and submission are never retried automatically.
   * @param message Original MIME and delivery envelope.
   * @param options Optional cancellation signal.
   * @returns A receipt; uncertain submission outcomes are non-retryable.
   * @throws {Error} If cancellation is requested.
   */
  async sendRaw(message, options) {
    if (message?.content instanceof Promise) message.content.catch(() => {});
    const signal = options?.signal;
    signal?.throwIfAborted();
    try {
      const plan = createRawMessagePlan(message);
      const session = await rawOperation(
        this.config.timeout,
        (owned) => this.getSession(owned),
        signal,
      );
      const capable = (id) => {
        const account = session.accounts[id];
        return (
          account != null &&
          !account.isReadOnly &&
          JMAP_CAPABILITIES.mail in account.accountCapabilities &&
          JMAP_CAPABILITIES.submission in account.accountCapabilities
        );
      };
      const accountId = this.config.accountId ?? Object.keys(session.accounts).find(capable);
      if (
        accountId == null ||
        !capable(accountId) ||
        !Object.values(JMAP_CAPABILITIES).every((capability) => capability in session.capabilities)
      ) {
        return createJmapFailure('No writable mail and submission account found.', undefined, {
          category: 'configuration',
          code: 'jmap.no_mail_account',
          retryable: false,
        });
      }
      const drafts = await rawOperation(
        this.config.timeout,
        (owned) => this.getDraftsMailboxId(session, accountId, owned, true),
        signal,
      );
      const identity = await rawOperation(
        this.config.timeout,
        (owned) => this.getIdentityId(session, accountId, plan.envelope.from ?? '', owned, true),
        signal,
      );
      return await deliverRawMessage(
        this.config,
        session,
        accountId,
        drafts,
        identity,
        plan,
        signal,
      );
    } catch (error) {
      signal?.throwIfAborted();
      return createJmapFailure(
        error instanceof Error ? error.message : String(error),
        error,
        error instanceof RawMessageValidationError
          ? {
              category: 'validation',
              code: 'jmap.raw_message_invalid',
              retryable: false,
            }
          : undefined,
      );
    }
  }

  /**
   * Sends multiple messages in a single batched JMAP request.
   * @param messages The messages to send.
   * @param options Optional transport options.
   * @yields Receipts for each message.
   * @throws The abort reason or an `AbortError` when the caller aborts the
   *         operation.
   */
  async *sendMany(messages, options) {
    const signal = options?.signal;

    // Collect all messages into an array first
    const messageArray = [];
    for await (const message of messages) {
      messageArray.push(message);
    }

    // If no messages, return early
    if (messageArray.length === 0) {
      return;
    }

    // Track processing stage for better error messages
    let processingStage = 'initialization';
    let attachmentsUploadedCount = 0;

    try {
      signal?.throwIfAborted();

      // Get or refresh session (once)
      processingStage = 'session fetch';
      const session = await this.getSession(signal);
      signal?.throwIfAborted();

      // Get account ID (once)
      processingStage = 'account discovery';
      const accountId = this.config.accountId ?? findMailAccount(session);
      if (!accountId) {
        for (let i = 0; i < messageArray.length; i++) {
          yield createJmapFailure('No mail-capable account found in JMAP session', undefined, {
            category: 'configuration',
            code: 'jmap.no_mail_account',
            retryable: false,
          });
        }
        return;
      }

      // Get drafts mailbox ID (once)
      processingStage = 'mailbox discovery';
      const draftsMailboxId = await this.getDraftsMailboxId(session, accountId, signal);
      signal?.throwIfAborted();

      // Get identities (once) and build a map
      processingStage = 'identity resolution';
      const identityMap = await this.getIdentityMap(session, accountId, signal);
      signal?.throwIfAborted();

      // Upload all attachments for all messages
      processingStage = 'attachment upload';
      const allUploadedBlobs = new Map();
      for (let i = 0; i < messageArray.length; i++) {
        const message = messageArray[i];
        const uploadedBlobs = await this.uploadAttachments(
          session,
          accountId,
          message.attachments,
          signal,
        );
        allUploadedBlobs.set(i, uploadedBlobs);
        attachmentsUploadedCount = i + 1;
        signal?.throwIfAborted();
      }

      // Build batch Email/set and EmailSubmission/set create objects
      processingStage = 'message conversion';
      const emailCreates = {};
      const submissionCreates = {};

      for (let i = 0; i < messageArray.length; i++) {
        const message = messageArray[i];
        const uploadedBlobs = allUploadedBlobs.get(i);
        const emailCreate = convertMessage(message, draftsMailboxId, uploadedBlobs);

        // Find identity for this sender
        const senderEmail = message.sender.address.toLowerCase();
        const identityId = identityMap.get(senderEmail) ?? identityMap.values().next().value;

        emailCreates[`draft${i}`] = emailCreate;
        submissionCreates[`sub${i}`] = {
          identityId,
          emailId: `#draft${i}`,
        };
      }

      // Execute batch request
      processingStage = 'batch request execution';
      const response = await this.httpClient.executeRequest(
        session.apiUrl,
        {
          using: [JMAP_CAPABILITIES.core, JMAP_CAPABILITIES.mail, JMAP_CAPABILITIES.submission],
          methodCalls: [
            [
              'Email/set',
              {
                accountId,
                create: emailCreates,
              },
              'c0',
            ],
            [
              'EmailSubmission/set',
              {
                accountId,
                create: submissionCreates,
              },
              'c1',
            ],
          ],
        },
        signal,
      );

      // Parse batch response and yield individual receipts
      for (let i = 0; i < messageArray.length; i++) {
        yield this.parseBatchResponseForIndex(response, i);
      }
    } catch (error) {
      if (signal?.aborted) {
        throw getAbortReason(signal, error);
      }

      const timeoutOverride =
        error instanceof Error && error.name === 'AbortError'
          ? {
              category: 'timeout',
              code: 'abort',
              retryable: true,
            }
          : undefined;

      // For any error during batch processing, yield failure for all messages
      // with detailed stage information
      const baseMessage =
        error instanceof Error && error.name === 'AbortError'
          ? `Request aborted: ${error.message}`
          : error instanceof JmapApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);

      // Build detailed error message with stage and progress info
      let detailedMessage = `Failed during ${processingStage}: ${baseMessage}`;
      if (processingStage === 'attachment upload' && attachmentsUploadedCount > 0) {
        detailedMessage += ` (${attachmentsUploadedCount}/${messageArray.length} messages had attachments uploaded before failure)`;
      }

      for (let i = 0; i < messageArray.length; i++) {
        yield createJmapFailure(detailedMessage, error, timeoutOverride);
      }
    }
  }

  /**
   * Gets or refreshes the JMAP session.
   * @param signal Optional abort signal.
   * @returns The JMAP session.
   */
  async getSession(signal) {
    const now = Date.now();

    // Check cache
    if (this.cachedSession && now - this.cachedSession.fetchedAt < this.config.sessionCacheTtl) {
      return this.cachedSession.session;
    }

    // Fetch new session
    let session = await this.httpClient.fetchSession(signal);

    // Rewrite URLs if baseUrl is configured
    if (this.config.baseUrl) {
      session = this.rewriteSessionUrls(session);
    }

    // Cache it
    this.cachedSession = {
      session,
      fetchedAt: now,
    };

    return session;
  }

  /**
   * Rewrites session URLs to use the configured baseUrl.
   * @param session The original session from the server.
   * @returns A new session with rewritten URLs.
   */
  rewriteSessionUrls(session) {
    const baseUrl = this.config.baseUrl;

    const rewriteUrl = (url) => {
      try {
        // Parse just the base URL to get the target protocol and host
        const base = new URL(baseUrl);
        // Use regex to replace the protocol and host, preserving templates like {accountId}
        return url.replace(/^(\w+):\/\/[^/]+/, `${base.protocol}//${base.host}`);
      } catch {
        return url;
      }
    };

    return {
      ...session,
      apiUrl: rewriteUrl(session.apiUrl),
      downloadUrl: rewriteUrl(session.downloadUrl),
      uploadUrl: rewriteUrl(session.uploadUrl),
      eventSourceUrl: session.eventSourceUrl ? rewriteUrl(session.eventSourceUrl) : undefined,
    };
  }

  /**
   * Gets the drafts mailbox ID from the session.
   * @param session The JMAP session.
   * @param accountId The account ID.
   * @param signal Optional abort signal.
   * @returns The drafts mailbox ID.
   */
  async getDraftsMailboxId(session, accountId, signal, strict = false) {
    const response = await this.httpClient.executeRequest(
      session.apiUrl,
      {
        using: [JMAP_CAPABILITIES.core, JMAP_CAPABILITIES.mail],
        methodCalls: [
          [
            'Mailbox/get',
            {
              accountId,
              properties: ['id', 'role', 'name'],
            },
            'c0',
          ],
        ],
      },
      signal,
    );

    const mailboxResponse = strict
      ? rawDiscoveryResult(response, 'Mailbox/get', accountId)
      : response.methodResponses.find((r) => r[0] === 'Mailbox/get')?.[1];

    if (!mailboxResponse) {
      throw new JmapApiError('No Mailbox/get response received');
    }

    const mailboxes = mailboxResponse.list;

    if (!mailboxes) {
      throw new JmapApiError('No mailboxes found');
    }

    if (
      strict &&
      (!Array.isArray(mailboxes) ||
        !mailboxes.every(
          (mailbox) => isRecord(mailbox) && typeof mailbox.id === 'string' && mailbox.id.length > 0,
        ))
    ) {
      throw new JmapApiError('Invalid mailbox identifiers in raw discovery.');
    }
    // Find drafts mailbox
    const drafts = mailboxes.find((m) => m.role === 'drafts');

    if (!drafts) {
      throw new JmapApiError('No drafts mailbox found');
    }

    return drafts.id;
  }

  /**
   * Gets the identity ID for the sender.
   * @param session The JMAP session.
   * @param accountId The account ID.
   * @param senderEmail The sender's email address.
   * @param signal Optional abort signal.
   * @returns The identity ID.
   */
  async getIdentityId(session, accountId, senderEmail, signal, strict = false) {
    // If identity ID is configured, use it
    if (this.config.identityId) {
      return this.config.identityId;
    }

    const identityMap = await this.getIdentityMap(session, accountId, signal, strict);
    const matching = identityMap.get(senderEmail.toLowerCase());
    if (matching) {
      return matching;
    }

    // Fall back to first identity
    return identityMap.values().next().value;
  }

  /**
   * Gets all identities and builds a map of email to identity ID.
   * @param session The JMAP session.
   * @param accountId The account ID.
   * @param signal Optional abort signal.
   * @returns Map of lowercase email to identity ID.
   */
  async getIdentityMap(session, accountId, signal, strict = false) {
    // If identity ID is configured, return a map with just that
    if (this.config.identityId) {
      return new Map([['*', this.config.identityId]]);
    }

    const response = await this.httpClient.executeRequest(
      session.apiUrl,
      {
        using: [JMAP_CAPABILITIES.core, JMAP_CAPABILITIES.submission],
        methodCalls: [
          [
            'Identity/get',
            {
              accountId,
            },
            'c0',
          ],
        ],
      },
      signal,
    );

    const identityResponse = strict
      ? rawDiscoveryResult(response, 'Identity/get', accountId)
      : response.methodResponses.find((r) => r[0] === 'Identity/get')?.[1];

    if (!identityResponse) {
      throw new JmapApiError('No Identity/get response received');
    }

    const identities = identityResponse.list;

    if (!identities || identities.length === 0) {
      throw new JmapApiError('No identities found');
    }

    if (
      strict &&
      (!Array.isArray(identities) ||
        !identities.every(
          (identity) =>
            isRecord(identity) &&
            typeof identity.id === 'string' &&
            identity.id.length > 0 &&
            typeof identity.email === 'string',
        ))
    ) {
      throw new JmapApiError('Invalid identity identifiers in raw discovery.');
    }
    const identityMap = new Map();
    for (const identity of identities) {
      identityMap.set(identity.email.toLowerCase(), identity.id);
    }

    return identityMap;
  }

  /**
   * Uploads all attachments and returns a map of contentId to blobId.
   * @param session The JMAP session.
   * @param accountId The account ID.
   * @param attachments Array of attachments to upload.
   * @param signal Optional abort signal.
   * @returns Map of contentId to blobId.
   */
  async uploadAttachments(session, accountId, attachments, signal) {
    const uploadedBlobs = new Map();

    for (const attachment of attachments) {
      signal?.throwIfAborted();

      const content = await readAttachmentContent(attachment.content, signal);

      // Create a Blob from the Uint8Array
      // Extract the ArrayBuffer portion to ensure TypeScript compatibility
      const arrayBuffer = content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      );
      const blob = new Blob([arrayBuffer], { type: attachment.contentType });

      const result = await uploadBlob(this.config, session.uploadUrl, accountId, blob, signal);

      uploadedBlobs.set(attachment.contentId, result.blobId);
    }

    return uploadedBlobs;
  }

  /**
   * Parses the JMAP response to extract receipt information.
   * @param response The JMAP response.
   * @returns A receipt indicating success or failure.
   */
  parseResponse(response) {
    const errors = [];

    // Check Email/set response
    const emailResponse = response.methodResponses.find((r) => r[0] === 'Email/set');

    if (emailResponse) {
      const emailResult = emailResponse[1];

      if (emailResult.notCreated) {
        for (const [key, error] of Object.entries(emailResult.notCreated)) {
          errors.push(
            `Email creation failed (${key}): ${error.type}${
              error.description ? ` - ${error.description}` : ''
            }`,
          );
        }
      }
    }

    // Check EmailSubmission/set response
    const submissionResponse = response.methodResponses.find((r) => r[0] === 'EmailSubmission/set');

    if (submissionResponse) {
      const submissionResult = submissionResponse[1];

      if (submissionResult.notCreated) {
        for (const [key, error] of Object.entries(submissionResult.notCreated)) {
          errors.push(
            `Email submission failed (${key}): ${error.type}${
              error.description ? ` - ${error.description}` : ''
            }`,
          );
        }
      }

      // Success case
      if (submissionResult.created?.submission) {
        return {
          successful: true,
          messageId: submissionResult.created.submission.id,
          provider: 'jmap',
        };
      }
    }

    // If no errors but no success either, something is wrong
    if (errors.length === 0) {
      errors.push('Unknown error: No submission result received');
    }

    return createFailedReceipt(errors, {
      provider: 'jmap',
      category: 'rejected',
      code: 'jmap.submission_failed',
      retryable: false,
    });
  }

  /**
   * Parses the JMAP batch response to extract receipt for a specific index.
   * @param response The JMAP response.
   * @param index The message index in the batch.
   * @returns A receipt indicating success or failure for that message.
   */
  parseBatchResponseForIndex(response, index) {
    const errors = [];
    const draftKey = `draft${index}`;
    const subKey = `sub${index}`;

    // Check Email/set response
    const emailResponse = response.methodResponses.find((r) => r[0] === 'Email/set');

    if (emailResponse) {
      const emailResult = emailResponse[1];

      if (emailResult.notCreated?.[draftKey]) {
        const error = emailResult.notCreated[draftKey];
        errors.push(
          `Email creation failed: ${error.type}${
            error.description ? ` - ${error.description}` : ''
          }`,
        );
      }
    }

    // Check EmailSubmission/set response
    const submissionResponse = response.methodResponses.find((r) => r[0] === 'EmailSubmission/set');

    if (submissionResponse) {
      const submissionResult = submissionResponse[1];

      if (submissionResult.notCreated?.[subKey]) {
        const error = submissionResult.notCreated[subKey];
        errors.push(
          `Email submission failed: ${error.type}${
            error.description ? ` - ${error.description}` : ''
          }`,
        );
      }

      // Success case
      if (submissionResult.created?.[subKey]) {
        return {
          successful: true,
          messageId: submissionResult.created[subKey].id,
          provider: 'jmap',
        };
      }
    }

    // If no errors but no success either
    if (errors.length === 0) {
      errors.push('Unknown error: No submission result received');
    }

    return createFailedReceipt(errors, {
      provider: 'jmap',
      category: 'rejected',
      code: 'jmap.submission_failed',
      retryable: false,
    });
  }
}

const createJmapFailure = (message, error, override = {}) => {
  const attempts = getAttemptCount(error);

  if (error instanceof JmapApiError) {
    return createFailedReceipt(message, {
      provider: 'jmap',
      statusCode: error.statusCode,
      retryAfterMilliseconds: error.retryAfterMilliseconds,
      attempts,
      providerDetails: {
        responseBody: error.responseBody,
        jmapErrorType: error.jmapErrorType,
      },
      category: override.category,
      code: override.code,
      retryable: override.retryable,
    });
  }

  return createFailedReceipt(message, {
    provider: 'jmap',
    attempts,
    category: override.category,
    code: override.code,
    retryable: override.retryable,
  });
};

const getAttemptCount = (error) => {
  if (error instanceof JmapApiError) {
    return error.attempts ?? 1;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'attempts' in error &&
    typeof error.attempts === 'number'
  ) {
    return error.attempts;
  }

  return 1;
};

const getAbortReason = (signal, fallback) => {
  return (
    signal.reason ??
    (isAbortError(fallback) ? fallback : undefined) ??
    new DOMException('The operation was aborted.', 'AbortError')
  );
};

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

/** Bounds verification through body consumption, not just receipt of headers. */
const verificationOperation = async (timeout, operation, signal) => {
  const controller = new AbortController();
  const combined = combineSignals(controller.signal, signal);
  let onAbort;
  const timer = setTimeout(
    () => controller.abort(new JmapApiError('JMAP verification timed out.')),
    timeout,
  );
  try {
    combined.signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      onAbort = () => reject(combined.signal.reason);
      combined.signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve()
        .then(() => {
          combined.signal.throwIfAborted();
          return operation(combined.signal);
        })
        .then(resolve, reject);
      if (combined.signal.aborted) onAbort();
    });
  } finally {
    clearTimeout(timer);
    if (onAbort) combined.signal.removeEventListener('abort', onAbort);
    controller.abort();
    combined.cleanup();
  }
};

const validateVerificationApiUrl = (value) => {
  if (typeof value === 'string' && URL.canParse(value)) {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return;
  }
  throw new JmapApiError('Invalid JMAP Session field: apiUrl');
};

const validateVerificationSession = (session) => {
  if (!isRecord(session)) {
    throw new JmapApiError('Invalid JMAP Session response.');
  }
  if (!isRecord(session.capabilities)) {
    throw new JmapApiError('Invalid JMAP Session field: capabilities');
  }
  if (!isRecord(session.accounts)) {
    throw new JmapApiError('Invalid JMAP Session field: accounts');
  }
  for (const [id, account] of Object.entries(session.accounts)) {
    if (
      !isRecord(account) ||
      typeof account.isReadOnly !== 'boolean' ||
      !isRecord(account.accountCapabilities)
    ) {
      throw new JmapApiError(`Invalid JMAP Session account: ${id}`);
    }
  }
  validateVerificationApiUrl(session.apiUrl);
};

/** Validates only the discovery fields used by verification. */
const verificationResult = (response, method, accountId) => {
  if (!isRecord(response) || !Array.isArray(response.methodResponses)) {
    throw new JmapApiError('Invalid JMAP verification response.');
  }
  const matches = response.methodResponses.filter(
    (entry) => Array.isArray(entry) && entry[2] === 'verify',
  );
  if (matches.length !== 1) {
    throw new JmapApiError('Missing or duplicate JMAP verification response.');
  }
  const entry = matches[0];
  if (!Array.isArray(entry) || entry.length !== 3 || !isRecord(entry[1])) {
    throw new JmapApiError('Invalid JMAP verification method response.');
  }
  const result = entry[1];
  if (entry[0] === 'error') {
    if (typeof result.type !== 'string' || !result.type) {
      throw new JmapApiError('Invalid JMAP method error.');
    }
    throw new JmapApiError(
      typeof result.description === 'string'
        ? result.description
        : `JMAP method failed: ${result.type}`,
      undefined,
      undefined,
      result.type,
    );
  }
  if (
    entry[0] !== method ||
    result.accountId !== accountId ||
    !Array.isArray(result.list) ||
    !Array.isArray(result.notFound)
  ) {
    throw new JmapApiError(`Invalid JMAP discovery result: ${method}`);
  }
  const list = [];
  const ids = new Set();
  for (const item of result.list) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) {
      throw new JmapApiError(`Invalid JMAP discovery identifiers: ${method}`);
    }
    ids.add(item.id);
    list.push(item);
  }
  const notFound = [];
  for (const id of result.notFound) {
    if (typeof id !== 'string' || !id || ids.has(id)) {
      throw new JmapApiError(`Contradictory JMAP discovery identifiers: ${method}`);
    }
    ids.add(id);
    notFound.push(id);
  }
  if (
    method === 'Mailbox/get' &&
    (notFound.length > 0 ||
      !list.every((item) => item.role == null || typeof item.role === 'string'))
  ) {
    throw new JmapApiError('Invalid JMAP mailbox discovery result.');
  }
  return { list, notFound };
};

module.exports = { JmapTransport };
