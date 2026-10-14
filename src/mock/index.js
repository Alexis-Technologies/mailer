// Ported from upyo v0.7.0 (packages/mock/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * @alexify/mailer/mock - Mock email transport for testing
 *
 * A mock transport implementation that doesn't actually send emails but stores
 * them in memory, making it useful for unit testing email functionality.
 *
 * @example
 * ```typescript
 * import { MockTransport } from "@alexify/mailer/mock";
 * import { createMessage } from "@alexify/mailer";
 *
 * const transport = new MockTransport({
 *   delay: 100, // Simulate network delay
 *   failureRate: 0.1 // 10% failure rate
 * });
 *
 * const message = createMessage({
 *   from: "sender@example.com",
 *   to: "recipient@example.com",
 *   subject: "Test Email",
 *   content: { text: "This is a test email" }
 * });
 *
 * await transport.send(message);
 *
 * // Verify the message was "sent"
 * const sentMessages = transport.getSentMessages();
 * console.log(`Sent ${sentMessages.length} messages`);
 * ```
 *
 * @module
 */

const { MockTransport } = require('./mock-transport.js');

module.exports = { MockTransport };
