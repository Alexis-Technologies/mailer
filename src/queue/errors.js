// Not ported: the error of ./queue, with a stable `code`: a job enqueued
// again under its key for another message, or a job that is not one.

/**
 * A failure of the queue: `queue.key_reused`, `queue.invalid_job`,
 * `queue.unsupported_version`, `queue.hash_mismatch`,
 * `queue.signature_invalid`, `queue.codec_missing` or `queue.codec_failed`.
 */
class MailQueueError extends Error {
  /**
   * @param code The code of the failure.
   * @param message What happened.
   * @param options `cause`.
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = 'MailQueueError';
    this.code = code;
  }
}

module.exports = { MailQueueError };
