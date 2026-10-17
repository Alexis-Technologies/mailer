// Ported from upyo v0.7.0 (packages/mock/src/mock-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { sleep } = require('../internal/sleep.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { createMockConfig } = require('./config.js');

const hasAddress = (addresses, email) => {
  for (const address of addresses) {
    if (address.address === email) return true;
  }
  return false;
};

/**
 * A mock transport implementation for testing purposes.
 *
 * This transport doesn't actually send emails but stores them in memory,
 * making it useful for unit testing email functionality. It provides
 * comprehensive testing capabilities including message verification,
 * behavior simulation, and async utilities.
 */
class MockTransport {
  id = 'mock';

  /**
   * The resolved configuration used by this mock transport.
   */
  config;

  sentMessages = [];
  nextResponse = null;
  messageIdCounter = 1;

  /**
   * Creates a new MockTransport instance.
   *
   * @param config Configuration options for the mock transport behavior.
   */
  constructor(config = {}) {
    this.config = createMockConfig(config);
  }

  /**
   * Sends an email message through the mock transport.
   *
   * The message is stored in memory and can be retrieved for testing verification.
   * Respects configured delays, failure rates, and response overrides.
   *
   * @param message The email message to send.
   * @param options Transport options including abort signal.
   * @returns A promise that resolves to a receipt indicating success or failure.
   * @throws {DOMException} When the operation is aborted via `AbortSignal`.
   */
  async send(message, options) {
    // Check for cancellation
    options?.signal?.throwIfAborted();

    // Apply delay if configured; an abort ends it with the signal's reason.
    await this.applyDelay(options?.signal);

    // Store the message
    this.sentMessages.push(message);

    // Determine response
    const response = this.getResponse();

    return response;
  }

  /**
   * Sends multiple email messages through the mock transport.
   *
   * Each message is processed sequentially using the send() method, respecting
   * all configured behavior including delays and failure rates.
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Transport options including abort signal.
   * @returns An async iterable of receipts, one for each message.
   * @throws {DOMException} When the operation is aborted via `AbortSignal`.
   */
  async *sendMany(messages, options) {
    for await (const message of messages) {
      options?.signal?.throwIfAborted();
      yield await this.send(message, options);
    }
  }

  /**
   * Get all messages that have been "sent" through this transport.
   *
   * @returns A readonly array containing copies of all sent messages.
   */
  getSentMessages() {
    return [...this.sentMessages];
  }

  /**
   * Get the last message that was sent, or undefined if no messages have been sent.
   *
   * @returns The most recently sent message, or undefined if none.
   */
  getLastSentMessage() {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  /**
   * Get the total number of messages that have been sent.
   *
   * @returns The count of messages sent through this transport.
   */
  getSentMessagesCount() {
    return this.sentMessages.length;
  }

  /**
   * Clear all stored messages.
   *
   * This removes all messages from the internal storage but does not
   * reset other configuration like delays or failure rates.
   */
  clearSentMessages() {
    this.sentMessages = [];
  }

  /**
   * Set the response that will be returned for the next send operation.
   *
   * After being used once, it will revert to the default response.
   * This is useful for testing specific success or failure scenarios.
   *
   * @param receipt The receipt to return for the next send operation.
   */
  setNextResponse(receipt) {
    this.nextResponse = receipt;
  }

  /**
   * Set the default response that will be returned for send operations.
   *
   * This response is used when no next response is set and random failures
   * are not triggered.
   *
   * @param receipt The default receipt to return for send operations.
   */
  setDefaultResponse(receipt) {
    this.config = {
      ...this.config,
      defaultResponse: receipt,
    };
  }

  /**
   * Set the failure rate (0.0 to 1.0). When set, sends will randomly fail
   * at the specified rate instead of using the configured responses.
   *
   * @param rate The failure rate as a decimal between 0.0 and 1.0.
   * @throws {RangeError} When rate is not between 0.0 and 1.0.
   */
  setFailureRate(rate) {
    if (rate < 0 || rate > 1) {
      throw new RangeError('Failure rate must be between 0.0 and 1.0');
    }
    this.config = {
      ...this.config,
      failureRate: rate,
    };
  }

  /**
   * Set a fixed delay in milliseconds for all send operations.
   *
   * This overrides any random delay range that was previously configured.
   *
   * @param milliseconds The delay in milliseconds (must be non-negative).
   * @throws {RangeError} When milliseconds is negative.
   */
  setDelay(milliseconds) {
    if (milliseconds < 0) {
      throw new RangeError('Delay must be non-negative');
    }
    this.config = {
      ...this.config,
      delay: milliseconds,
      randomDelayRange: { min: 0, max: 0 },
    };
  }

  /**
   * Set a random delay range in milliseconds for send operations.
   *
   * This overrides any fixed delay that was previously configured.
   *
   * @param min The minimum delay in milliseconds.
   * @param max The maximum delay in milliseconds.
   * @throws {RangeError} When min or max is negative, or min > max.
   */
  setRandomDelay(min, max) {
    if (min < 0 || max < 0 || min > max) {
      throw new RangeError('Invalid delay range');
    }
    this.config = {
      ...this.config,
      delay: 0,
      randomDelayRange: { min, max },
    };
  }

  /**
   * Find the first message matching the given predicate.
   *
   * @param predicate A function that tests each message.
   * @returns The first matching message, or undefined if none found.
   */
  findMessageBy(predicate) {
    for (const message of this.sentMessages) {
      if (predicate(message)) return message;
    }
    return undefined;
  }

  /**
   * Find all messages matching the given predicate.
   *
   * @param predicate A function that tests each message.
   * @returns An array of all matching messages.
   */
  findMessagesBy(predicate) {
    const found = [];
    for (const message of this.sentMessages) {
      if (predicate(message)) found.push(message);
    }
    return found;
  }

  /**
   * Get all messages sent to a specific email address.
   *
   * Searches through To, CC, and BCC recipients to find messages
   * that were sent to the specified email address.
   *
   * @param email The email address to search for.
   * @returns An array of messages sent to the specified address.
   */
  getMessagesTo(email) {
    return this.findMessagesBy(
      (message) =>
        hasAddress(message.recipients, email) ||
        hasAddress(message.ccRecipients, email) ||
        hasAddress(message.bccRecipients, email),
    );
  }

  /**
   * Get all messages with a specific subject.
   *
   * @param subject The exact subject line to match.
   * @returns An array of messages with the specified subject.
   */
  getMessagesBySubject(subject) {
    return this.findMessagesBy((message) => message.subject === subject);
  }

  /**
   * Wait for a specific number of messages to be sent.
   *
   * This method polls the message count until the target is reached or
   * the timeout expires.  Useful for testing async email workflows where you
   * need to wait for messages to be sent.
   *
   * @param count The number of messages to wait for.
   * @param timeout The timeout in milliseconds (default: 5000).
   * @returns A promise that resolves when the count is reached.
   * @throws {Error} When the timeout is exceeded before reaching the target
   *                 count.
   */
  async waitForMessageCount(count, timeout = 5000) {
    const startTime = Date.now();

    while (this.sentMessages.length < count) {
      if (Date.now() - startTime > timeout) {
        throw new Error(`Timeout waiting for ${count} messages (got ${this.sentMessages.length})`);
      }
      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Wait for a message matching the given predicate.
   *
   * This method polls for a matching message until one is found or the timeout
   * expires.  Useful for testing async email workflows where you need to wait
   * for specific messages.
   *
   * @param predicate A function that tests each message for a match.
   * @param timeout The timeout in milliseconds (default: 5000).
   * @returns A promise that resolves with the matching message.
   * @throws {Error} When the timeout is exceeded before finding a matching
   *                 message.
   */
  async waitForMessage(predicate, timeout = 5000) {
    const startTime = Date.now();

    while (true) {
      const message = this.findMessageBy(predicate);
      if (message) {
        return message;
      }

      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for message');
      }

      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Reset the transport to its initial state.
   *
   * Clears all messages, resets all configuration to defaults, and
   * resets the message ID counter. This is useful for test cleanup.
   */
  reset() {
    this.sentMessages = [];
    this.nextResponse = null;
    this.config = createMockConfig();
    this.messageIdCounter = 1;
  }

  async applyDelay(signal) {
    let delayMs = this.config.delay;

    if (
      this.config.randomDelayRange &&
      (this.config.randomDelayRange.min > 0 || this.config.randomDelayRange.max > 0)
    ) {
      const { min, max } = this.config.randomDelayRange;
      delayMs = (this.config.random ?? Math.random)() * (max - min) + min;
    }

    if (delayMs > 0) {
      await sleep(delayMs, signal);
    }
  }

  getResponse() {
    // Check for random failure first
    if (
      this.config.failureRate > 0 &&
      (this.config.random ?? Math.random)() < this.config.failureRate
    ) {
      return createFailedReceipt('Simulated random failure', {
        provider: 'mock',
        category: 'unknown',
        code: 'mock.random_failure',
        retryable: true,
        attempts: 1,
      });
    }

    // Use next response if set
    if (this.nextResponse) {
      const response = this.nextResponse;
      this.nextResponse = null;
      return response;
    }

    // Use default response, generating unique message ID if successful
    if (this.config.defaultResponse.successful && this.config.generateUniqueMessageIds) {
      const { attempts, timestamp } = this.config.defaultResponse;
      return {
        successful: true,
        messageId: `mock-message-${this.messageIdCounter++}`,
        provider: 'mock',
        ...(attempts == null ? {} : { attempts }),
        ...(timestamp == null ? {} : { timestamp }),
      };
    }

    return this.config.defaultResponse;
  }
}

module.exports = { MockTransport };
