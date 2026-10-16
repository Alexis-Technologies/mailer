// Ported from upyo v0.7.0 (packages/jmap/src/jmap-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { createRawMessagePlan, RawMessageValidationError } = require('../core/raw-message.js');
const { deliverRawMessage, rawDiscoveryResult } = require('./raw-delivery.js');
const { findOnlyResponse, isRecord, rawOperation } = require('./raw-upload.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { uploadBlob } = require('./blob-uploader.js');
const { createJmapConfig } = require('./config.js');
const { JmapApiError } = require('./errors.js');
const { JmapHttpClient } = require('./http-client.js');
const { isDeliveryUnknown, markDeliveryUnknown } = require('../internal/delivery-unknown.js');
const { isUnsentRequestError } = require('../internal/unsent.js');
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
    // The request that creates and submits the email is never replayed: a
    // retry after a lost answer could submit the message twice.
    this.submissionClient = new JmapHttpClient({ ...this.config, retries: 0 });
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
      checkSessionUrls(session, this.config);
      if (!hasRequiredCapabilities(session.capabilities)) {
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
      if (findDraftsMailbox(mailboxes.list, false) === undefined) {
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
        !haveEmails(identities.list) ||
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
      const response = await executeSubmission(
        this.submissionClient,
        session.apiUrl,
        submissionRequest(accountId, emailCreate, identityId),
        signal,
      );

      // Parse response
      return this.parseResponse(response);
    } catch (error) {
      this.forgetSessionAfter(error);
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
      const accountId = this.config.accountId ?? findAccount(session.accounts, capable);
      if (
        accountId == null ||
        !capable(accountId) ||
        !hasRequiredCapabilities(session.capabilities)
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
      this.forgetSessionAfter(error);
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

    // What every batch shares is discovered once; if it fails, every message
    // fails with it.
    let processingStage = 'initialization';
    let discovered;
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

      discovered = { session, accountId, draftsMailboxId, identityMap };
    } catch (error) {
      for (const failure of this.failBatch(
        error,
        processingStage,
        messageArray.length,
        0,
        signal,
      )) {
        yield failure;
      }
      return;
    }

    // RFC 8620 §2: a server may limit the objects one /set method creates;
    // a batch over it would be refused as a whole.
    const limit = getMaxObjectsInSet(discovered.session);
    for (let start = 0; start < messageArray.length; start += limit) {
      const batch = messageArray.slice(start, start + limit);
      for await (const receipt of this.sendBatch(discovered, batch, signal)) {
        yield receipt;
      }
    }
  }

  /**
   * Submits one batch of messages in a single Email/set and EmailSubmission/set
   * request, yielding a receipt per message; a failure fails the batch only.
   */
  async *sendBatch(discovered, batch, signal) {
    const { session, accountId, draftsMailboxId, identityMap } = discovered;
    let processingStage = 'attachment upload';
    let attachmentsUploadedCount = 0;
    try {
      // Upload all attachments for all messages
      const allUploadedBlobs = new Map();
      for (let i = 0; i < batch.length; i++) {
        const uploadedBlobs = await this.uploadAttachments(
          session,
          accountId,
          batch[i].attachments,
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

      for (let i = 0; i < batch.length; i++) {
        const message = batch[i];
        const emailCreate = convertMessage(message, draftsMailboxId, allUploadedBlobs.get(i));

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
      const response = await executeSubmission(
        this.submissionClient,
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

      // The results of the sets are found once for the whole batch.
      const results = setResultsOf(response);
      for (let i = 0; i < batch.length; i++) {
        yield this.parseBatchResponseForIndex(results, i);
      }
    } catch (error) {
      for (const failure of this.failBatch(
        error,
        processingStage,
        batch.length,
        attachmentsUploadedCount,
        signal,
      )) {
        yield failure;
      }
    }
  }

  /**
   * The receipts of a batch that failed at `processingStage`, one per message,
   * after the abort of the caller, which is thrown instead.
   */
  *failBatch(error, processingStage, count, attachmentsUploadedCount, signal) {
    this.forgetSessionAfter(error);
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
    let baseMessage = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === 'AbortError') {
      baseMessage = `Request aborted: ${error.message}`;
    }

    // Build detailed error message with stage and progress info
    let detailedMessage = `Failed during ${processingStage}: ${baseMessage}`;
    if (processingStage === 'attachment upload' && attachmentsUploadedCount > 0) {
      detailedMessage += ` (${attachmentsUploadedCount}/${count} messages had attachments uploaded before failure)`;
    }

    for (let i = 0; i < count; i++) {
      yield createJmapFailure(detailedMessage, error, timeoutOverride);
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

    // Checked before it is cached: a Session that names another origin would
    // receive the credentials for as long as it stays cached.
    checkSessionUrls(session, this.config);

    // Cache it
    this.cachedSession = {
      session,
      fetchedAt: now,
    };

    return session;
  }

  // A rejected authentication or a URL that is gone may come from a Session
  // that changed since it was cached: the next send fetches it again.
  forgetSessionAfter(error) {
    if (error instanceof JmapApiError && (error.statusCode === 401 || error.statusCode === 404)) {
      this.cachedSession = null;
    }
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
      : findMethodResponse(response.methodResponses, 'Mailbox/get')?.[1];

    if (!mailboxResponse) {
      throw new JmapApiError('No Mailbox/get response received');
    }

    const mailboxes = mailboxResponse.list;

    if (!mailboxes) {
      throw new JmapApiError('No mailboxes found');
    }

    const drafts = findDraftsMailbox(mailboxes, strict);

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
      : findMethodResponse(response.methodResponses, 'Identity/get')?.[1];

    if (!identityResponse) {
      throw new JmapApiError('No Identity/get response received');
    }

    const identities = identityResponse.list;

    if (!identities || identities.length === 0) {
      throw new JmapApiError('No identities found');
    }

    if (strict && !Array.isArray(identities)) {
      throw new JmapApiError('Invalid identity identifiers in raw discovery.');
    }
    const identityMap = new Map();
    for (const identity of identities) {
      if (strict && !isIdentity(identity)) {
        throw new JmapApiError('Invalid identity identifiers in raw discovery.');
      }
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

      // Keyed by the attachment itself: content IDs repeat, and are empty for
      // every attachment that is not inline.
      uploadedBlobs.set(attachment, result.blobId);
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
    const { email, submission } = setResultsOf(response);
    for (const key in email?.notCreated) {
      errors.push(describeSetError(`Email creation failed (${key})`, email.notCreated[key]));
    }
    for (const key in submission?.notCreated) {
      errors.push(describeSetError(`Email submission failed (${key})`, submission.notCreated[key]));
    }
    if (submission?.created?.submission) {
      return { successful: true, messageId: submission.created.submission.id, provider: 'jmap' };
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
   * Gives the receipt of one message of a batch from the results of its sets.
   * @param results The Email/set and EmailSubmission/set results of the batch.
   * @param index The message index in the batch.
   * @returns A receipt indicating success or failure for that message.
   */
  parseBatchResponseForIndex(results, index) {
    const errors = [];
    const draftKey = `draft${index}`;
    const subKey = `sub${index}`;
    const { email, submission } = results;
    if (email?.notCreated?.[draftKey]) {
      errors.push(describeSetError('Email creation failed', email.notCreated[draftKey]));
    }
    if (submission?.notCreated?.[subKey]) {
      errors.push(describeSetError('Email submission failed', submission.notCreated[subKey]));
    }
    if (submission?.created?.[subKey]) {
      return { successful: true, messageId: submission.created[subKey].id, provider: 'jmap' };
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

const REQUIRED_CAPABILITIES = [
  JMAP_CAPABILITIES.core,
  JMAP_CAPABILITIES.mail,
  JMAP_CAPABILITIES.submission,
];

const hasRequiredCapabilities = (capabilities) => {
  for (const capability of REQUIRED_CAPABILITIES) {
    if (!(capability in capabilities)) return false;
  }
  return true;
};

// The first account, in the order of the Session, that `capable` accepts.
const findAccount = (accounts, capable) => {
  for (const id in accounts) {
    if (Object.hasOwn(accounts, id) && capable(id)) return id;
  }
  return undefined;
};

const findMethodResponse = (methodResponses, method) => {
  for (const entry of methodResponses) {
    if (entry[0] === method) return entry;
  }
  return undefined;
};

// The results of the first Email/set and EmailSubmission/set of a response,
// found in one pass.
const setResultsOf = (response) => {
  let email;
  let submission;
  for (const entry of response.methodResponses) {
    if (entry[0] === 'Email/set') email ??= entry[1];
    else if (entry[0] === 'EmailSubmission/set') submission ??= entry[1];
  }
  return { email, submission };
};

const describeSetError = (prefix, error) =>
  `${prefix}: ${error.type}${error.description ? ` - ${error.description}` : ''}`;

/**
 * Finds the drafts mailbox, checking every mailbox of a raw discovery.
 *
 * @param mailboxes The mailboxes of the account.
 * @param strict Whether each mailbox must carry an identifier.
 * @returns The first mailbox with the drafts role, if any.
 * @throws {JmapApiError} If a strict discovery has an invalid mailbox.
 */
const findDraftsMailbox = (mailboxes, strict) => {
  if (strict && !Array.isArray(mailboxes)) {
    throw new JmapApiError('Invalid mailbox identifiers in raw discovery.');
  }
  let drafts;
  for (const mailbox of mailboxes) {
    if (strict && !(isRecord(mailbox) && typeof mailbox.id === 'string' && mailbox.id !== '')) {
      throw new JmapApiError('Invalid mailbox identifiers in raw discovery.');
    }
    if (drafts === undefined && mailbox.role === 'drafts') {
      drafts = mailbox;
      if (!strict) break;
    }
  }
  return drafts;
};

const haveEmails = (identities) => {
  for (const identity of identities) {
    if (typeof identity.email !== 'string' || identity.email.length === 0) return false;
  }
  return true;
};

const isIdentity = (identity) =>
  isRecord(identity) &&
  typeof identity.id === 'string' &&
  identity.id.length > 0 &&
  typeof identity.email === 'string';

// The request that creates the draft of one message and submits it.
const submissionRequest = (accountId, emailCreate, identityId) => ({
  using: REQUIRED_CAPABILITIES,
  methodCalls: [
    ['Email/set', { accountId, create: { draft: emailCreate } }, 'c0'],
    [
      'EmailSubmission/set',
      { accountId, create: { submission: { identityId, emailId: '#draft' } } },
      'c1',
    ],
  ],
});

// Sends the request that creates and submits emails.  A failure without an
// answer from the server, unless the connection was never made, leaves it
// unknown whether the server submitted them.
const executeSubmission = async (client, apiUrl, request, signal) => {
  try {
    return await client.executeRequest(apiUrl, request, signal);
  } catch (error) {
    const isUnanswered = error instanceof JmapApiError && error.statusCode === undefined;
    throw isUnanswered && !isUnsentRequestError(error) ? markDeliveryUnknown(error) : error;
  }
};

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
      deliveryUnknown: isDeliveryUnknown(error),
    });
  }

  return createFailedReceipt(message, {
    provider: 'jmap',
    attempts,
    category: override.category,
    code: override.code,
    retryable: override.retryable,
    deliveryUnknown: isDeliveryUnknown(error),
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

const getMaxObjectsInSet = (session) => {
  const limit = session.capabilities?.[JMAP_CAPABILITIES.core]?.maxObjectsInSet;
  return Number.isInteger(limit) && limit > 0 ? limit : Infinity;
};

// The URLs of a Session the transport sends its credentials to must be on the
// origin it fetched the Session from (that of baseUrl when URLs are rewritten)
// or on one of trustedOrigins.
const checkSessionUrls = (session, config) => {
  if (!isRecord(session)) throw new JmapApiError('Invalid JMAP Session response.');
  const trusted = new Set([new URL(config.baseUrl ?? config.sessionUrl).origin]);
  for (const origin of config.trustedOrigins) trusted.add(new URL(origin).origin);
  for (const name of ['apiUrl', 'uploadUrl', 'downloadUrl']) {
    const value = session[name];
    // Only apiUrl serves every send; the others are checked when given.
    if (value == null && name !== 'apiUrl') continue;
    const origin = typeof value === 'string' && URL.canParse(value) ? new URL(value).origin : null;
    if (origin == null) throw new JmapApiError(`Invalid JMAP Session field: ${name}`);
    if (!trusted.has(origin)) {
      throw new JmapApiError(
        `JMAP Session ${name} is on ${origin}, which is not trusted; ` +
          'list it in trustedOrigins if it is meant to receive the credentials.',
      );
    }
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
  const entry = findOnlyResponse(response.methodResponses, 'verify');
  if (entry === undefined) {
    throw new JmapApiError('Missing or duplicate JMAP verification response.');
  }
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
  let roles = true;
  for (const item of result.list) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) {
      throw new JmapApiError(`Invalid JMAP discovery identifiers: ${method}`);
    }
    if (item.role != null && typeof item.role !== 'string') roles = false;
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
  if (method === 'Mailbox/get' && (notFound.length > 0 || !roles)) {
    throw new JmapApiError('Invalid JMAP mailbox discovery result.');
  }
  return { list, notFound };
};

module.exports = { JmapTransport };
