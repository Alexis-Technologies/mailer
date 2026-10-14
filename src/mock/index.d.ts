// Types ported from upyo v0.7.0 (packages/mock/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import type { Message, Receipt, Transport, TransportOptions } from '../../index.js';

/**
 * Configuration interface for Mock transport.
 *
 * This interface defines options for configuring the mock transport's
 * behavior for testing scenarios.
 *
 * @example
 * ```typescript
 * const config: MockConfig = {
 *   defaultResponse: { successful: true, messageId: "test-123" },
 *   delay: 100,
 *   failureRate: 0.1
 * };
 * ```
 */
export interface MockConfig {
  /**
   * The default response to return for send operations.
   *
   * @default { successful: true, messageId: "mock-message-id" }
   */
  readonly defaultResponse?: Receipt<'mock'>;
  /**
   * Fixed delay in milliseconds for all send operations.
   *
   * @default 0
   */
  readonly delay?: number;
  /**
   * Random delay range in milliseconds for send operations.
   * When set, overrides the fixed delay setting.
   */
  readonly randomDelayRange?: {
    readonly min: number;
    readonly max: number;
  };
  /**
   * Failure rate (0.0 to 1.0) for random failures.
   * When set, sends will randomly fail at the specified rate.
   *
   * @default 0
   */
  readonly failureRate?: number;
  /**
   * Whether to automatically generate unique message IDs for successful responses.
   *
   * @default true
   */
  readonly generateUniqueMessageIds?: boolean;
}
/**
 * Resolved mock configuration with all optional fields filled with default values.
 *
 * This type represents the final configuration after applying defaults,
 * used internally by the mock transport implementation.
 */
type ResolvedMockConfig = Required<MockConfig>;
/**
 * Creates a resolved mock configuration by applying default values to optional fields.
 *
 * This function takes a partial mock configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 *
 * @param config - The mock configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 *
 * @example
 * ```typescript
 * const resolved = createMockConfig({
 *   delay: 100
 * });
 *
 * // resolved.defaultResponse will be { successful: true, messageId: "mock-message-id" }
 * // resolved.failureRate will be 0 (default)
 * // resolved.generateUniqueMessageIds will be true (default)
 * ```
 */

/**
 * A mock transport implementation for testing purposes.
 *
 * This transport doesn't actually send emails but stores them in memory,
 * making it useful for unit testing email functionality. It provides
 * comprehensive testing capabilities including message verification,
 * behavior simulation, and async utilities.
 */
export declare class MockTransport implements Transport<'mock'> {
  readonly id = 'mock';
  /**
   * The resolved configuration used by this mock transport.
   */
  config: ResolvedMockConfig;
  /**
   * Creates a new MockTransport instance.
   *
   * @param config Configuration options for the mock transport behavior.
   */
  constructor(config?: MockConfig);
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
  send(message: Message, options?: TransportOptions): Promise<Receipt<'mock'>>;
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
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'mock'>>;
  /**
   * Get all messages that have been "sent" through this transport.
   *
   * @returns A readonly array containing copies of all sent messages.
   */
  getSentMessages(): readonly Message[];
  /**
   * Get the last message that was sent, or undefined if no messages have been sent.
   *
   * @returns The most recently sent message, or undefined if none.
   */
  getLastSentMessage(): Message | undefined;
  /**
   * Get the total number of messages that have been sent.
   *
   * @returns The count of messages sent through this transport.
   */
  getSentMessagesCount(): number;
  /**
   * Clear all stored messages.
   *
   * This removes all messages from the internal storage but does not
   * reset other configuration like delays or failure rates.
   */
  clearSentMessages(): void;
  /**
   * Set the response that will be returned for the next send operation.
   *
   * After being used once, it will revert to the default response.
   * This is useful for testing specific success or failure scenarios.
   *
   * @param receipt The receipt to return for the next send operation.
   */
  setNextResponse(receipt: Receipt<'mock'>): void;
  /**
   * Set the default response that will be returned for send operations.
   *
   * This response is used when no next response is set and random failures
   * are not triggered.
   *
   * @param receipt The default receipt to return for send operations.
   */
  setDefaultResponse(receipt: Receipt<'mock'>): void;
  /**
   * Set the failure rate (0.0 to 1.0). When set, sends will randomly fail
   * at the specified rate instead of using the configured responses.
   *
   * @param rate The failure rate as a decimal between 0.0 and 1.0.
   * @throws {RangeError} When rate is not between 0.0 and 1.0.
   */
  setFailureRate(rate: number): void;
  /**
   * Set a fixed delay in milliseconds for all send operations.
   *
   * This overrides any random delay range that was previously configured.
   *
   * @param milliseconds The delay in milliseconds (must be non-negative).
   * @throws {RangeError} When milliseconds is negative.
   */
  setDelay(milliseconds: number): void;
  /**
   * Set a random delay range in milliseconds for send operations.
   *
   * This overrides any fixed delay that was previously configured.
   *
   * @param min The minimum delay in milliseconds.
   * @param max The maximum delay in milliseconds.
   * @throws {RangeError} When min or max is negative, or min > max.
   */
  setRandomDelay(min: number, max: number): void;
  /**
   * Find the first message matching the given predicate.
   *
   * @param predicate A function that tests each message.
   * @returns The first matching message, or undefined if none found.
   */
  findMessageBy(predicate: (message: Message) => boolean): Message | undefined;
  /**
   * Find all messages matching the given predicate.
   *
   * @param predicate A function that tests each message.
   * @returns An array of all matching messages.
   */
  findMessagesBy(predicate: (message: Message) => boolean): readonly Message[];
  /**
   * Get all messages sent to a specific email address.
   *
   * Searches through To, CC, and BCC recipients to find messages
   * that were sent to the specified email address.
   *
   * @param email The email address to search for.
   * @returns An array of messages sent to the specified address.
   */
  getMessagesTo(email: string): readonly Message[];
  /**
   * Get all messages with a specific subject.
   *
   * @param subject The exact subject line to match.
   * @returns An array of messages with the specified subject.
   */
  getMessagesBySubject(subject: string): readonly Message[];
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
  waitForMessageCount(count: number, timeout?: number): Promise<void>;
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
  waitForMessage(predicate: (message: Message) => boolean, timeout?: number): Promise<Message>;
  /**
   * Reset the transport to its initial state.
   *
   * Clears all messages, resets all configuration to defaults, and
   * resets the message ID counter. This is useful for test cleanup.
   */
  reset(): void;
}
