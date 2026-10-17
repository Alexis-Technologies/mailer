// Ported from upyo v0.7.0 (packages/mailgun/src/test-utils/mailgun-delivery-utils.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Validates that a Mailgun receipt indicates successful delivery.
 *
 * @param receipt The receipt returned from Mailgun transport.
 */
const validateMailgunReceipt = (receipt) => {
  if (!receipt.successful) {
    throw new Error(`Email delivery failed: ${receipt.errorMessages.join(', ')}`);
  }

  if (!receipt.messageId) {
    throw new Error('No message ID returned from Mailgun');
  }

  // Mailgun message IDs typically start with < and end with >
  if (!receipt.messageId.startsWith('<') || !receipt.messageId.endsWith('>')) {
    console.warn(
      `Unexpected message ID format: ${receipt.messageId}. Expected format: <id@domain>`,
    );
  }
};

/**
 * Validates that multiple receipts from a batch operation are all successful.
 *
 * @param receipts Array of receipts from batch sending.
 * @param expectedCount Expected number of receipts.
 */
const validateBatchReceipts = (receipts, expectedCount) => {
  if (receipts.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} receipts, but got ${receipts.length}`);
  }

  const failedReceipts = receipts.filter((r) => !r.successful);
  if (failedReceipts.length > 0) {
    const errors = failedReceipts.map((r) =>
      !r.successful ? r.errorMessages.join(', ') : 'Unknown error',
    );
    throw new Error(
      `${failedReceipts.length} out of ${receipts.length} emails failed: ${errors.join('; ')}`,
    );
  }

  const receiptsWithoutIds = receipts.filter((r) => r.successful && !r.messageId);
  if (receiptsWithoutIds.length > 0) {
    throw new Error(`${receiptsWithoutIds.length} receipts missing message IDs`);
  }
};

/**
 * Waits for a specified duration to allow for email processing.
 * This is useful in E2E tests to ensure emails have been processed.
 *
 * @param milliseconds Duration to wait in milliseconds.
 */
const waitForEmailProcessing = (milliseconds = 2000) => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

/**
 * Extracts message ID from Mailgun receipt for further verification.
 *
 * @param receipt The receipt from Mailgun.
 * @returns The message ID without angle brackets.
 */
const extractMessageId = (receipt) => {
  if (!receipt.successful) {
    throw new Error('Cannot extract message ID from failed receipt');
  }

  if (!receipt.messageId) {
    throw new Error('No message ID in receipt');
  }

  // Remove angle brackets if present
  return receipt.messageId.replace(/^<|>$/g, '');
};

/**
 * Validates that an error receipt contains expected error information.
 *
 * @param receipt The receipt that should contain errors.
 * @param expectedErrorKeywords Keywords that should be present in error messages.
 */
const validateErrorReceipt = (receipt, expectedErrorKeywords = []) => {
  if (receipt.successful) {
    throw new Error('Expected receipt to indicate failure, but it was successful');
  }

  if (receipt.errorMessages.length === 0) {
    throw new Error('Expected error messages in failed receipt');
  }

  // Check for expected error keywords
  if (expectedErrorKeywords.length > 0) {
    const allErrors = receipt.errorMessages.join(' ').toLowerCase();
    const missingKeywords = expectedErrorKeywords.filter(
      (keyword) => !allErrors.includes(keyword.toLowerCase()),
    );

    if (missingKeywords.length > 0) {
      throw new Error(
        `Expected error keywords not found: ${missingKeywords.join(', ')}. ` +
          `Actual errors: ${receipt.errorMessages.join(', ')}`,
      );
    }
  }
};

/**
 * Validates that a message was sent successfully and matches expected criteria.
 * This function combines message validation with receipt validation.
 *
 * @param message The original message that was sent.
 * @param receipt The receipt returned from the transport.
 * @param expectedSubject Optional subject to validate against the message subject.
 */
const validateMessageDelivery = (message, receipt, expectedSubject) => {
  // First validate the receipt
  validateMailgunReceipt(receipt);

  // Then validate the message subject if expected
  if (expectedSubject !== undefined) {
    if (message.subject !== expectedSubject) {
      throw new Error(
        `Message subject mismatch. Expected: "${expectedSubject}", ` +
          `Actual: "${message.subject}"`,
      );
    }
  }

  if (receipt.successful) {
    console.info(`Message "${message.subject}" sent successfully with ID: ${receipt.messageId}`);
  }
};

module.exports = {
  validateMailgunReceipt,
  validateBatchReceipts,
  waitForEmailProcessing,
  extractMessageId,
  validateErrorReceipt,
  validateMessageDelivery,
};
