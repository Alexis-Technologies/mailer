// Ported from upyo v0.7.0 (packages/mock/src/test-utils/mock-validation-utils.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { isEmailAddress } = require('../../../src/core/address.js');

/**
 * Validates that a receipt indicates a successful send operation.
 *
 * @param receipt The receipt to validate
 * @throws {Error} If the receipt indicates failure
 */
const validateSuccessfulReceipt = (receipt) => {
  if (!receipt.successful) {
    throw new Error(
      `Expected successful receipt, but got failure: ${receipt.errorMessages.join(', ')}`,
    );
  }

  if (!receipt.messageId) {
    throw new Error('Expected message ID in successful receipt');
  }
};

/**
 * Validates that a receipt indicates a failed send operation.
 *
 * @param receipt The receipt to validate
 * @throws {Error} If the receipt indicates success
 */
const validateFailedReceipt = (receipt) => {
  if (receipt.successful) {
    throw new Error(
      `Expected failed receipt, but got success with message ID: ${receipt.messageId}`,
    );
  }

  if (!receipt.errorMessages || receipt.errorMessages.length === 0) {
    throw new Error('Expected error messages in failed receipt');
  }
};

/**
 * Validates that all receipts in the array are successful.
 *
 * @param receipts Array of receipts to validate
 * @throws {Error} If any receipt indicates failure
 */
const validateAllSuccessful = (receipts) => {
  const failedReceipts = receipts.filter((r) => !r.successful);
  if (failedReceipts.length > 0) {
    const errorMessages = failedReceipts.flatMap((r) => (r.successful ? [] : r.errorMessages));
    throw new Error(
      `Expected all receipts to be successful, but ${failedReceipts.length} failed: ${errorMessages.join(
        ', ',
      )}`,
    );
  }
};

/**
 * Validates that a message contains expected content.
 *
 * @param message The message to validate
 * @param expected Expected message properties
 * @throws {Error} If the message doesn't match expectations
 */
const validateMessageContent = (message, expected) => {
  if (expected.from && message.sender.address !== expected.from) {
    throw new Error(`Expected sender ${expected.from}, got ${message.sender.address}`);
  }

  if (expected.to) {
    const expectedTo = Array.isArray(expected.to) ? expected.to : [expected.to];
    const actualTo = message.recipients.map((r) => r.address);

    for (const expectedAddr of expectedTo) {
      if (!isEmailAddress(expectedAddr)) {
        throw new Error(`Invalid expected email address: ${expectedAddr}`);
      }
      if (!actualTo.includes(expectedAddr)) {
        throw new Error(
          `Expected recipient ${expectedAddr}, but not found in [${actualTo.join(', ')}]`,
        );
      }
    }
  }

  if (expected.subject && message.subject !== expected.subject) {
    throw new Error(`Expected subject "${expected.subject}", got "${message.subject}"`);
  }

  if (expected.textContent) {
    const textContent = 'text' in message.content ? message.content.text : message.content.text;
    if (!textContent || !textContent.includes(expected.textContent)) {
      throw new Error(`Expected text content to include "${expected.textContent}"`);
    }
  }

  if (expected.htmlContent) {
    const htmlContent = 'html' in message.content ? message.content.html : undefined;
    if (!htmlContent || !htmlContent.includes(expected.htmlContent)) {
      throw new Error(`Expected HTML content to include "${expected.htmlContent}"`);
    }
  }
};

/**
 * Validates that messages are delivered in the expected order.
 *
 * @param actualMessages Messages in the order they were sent
 * @param expectedSubjects Expected subjects in order
 * @throws {Error} If the order doesn't match
 */
const validateMessageOrder = (actualMessages, expectedSubjects) => {
  if (actualMessages.length !== expectedSubjects.length) {
    throw new Error(`Expected ${expectedSubjects.length} messages, got ${actualMessages.length}`);
  }

  for (let i = 0; i < expectedSubjects.length; i++) {
    if (actualMessages[i].subject !== expectedSubjects[i]) {
      throw new Error(
        `Message ${i}: expected subject "${expectedSubjects[i]}", got "${
          actualMessages[i].subject
        }"`,
      );
    }
  }
};

module.exports = {
  validateSuccessfulReceipt,
  validateFailedReceipt,
  validateAllSuccessful,
  validateMessageContent,
  validateMessageOrder,
};
