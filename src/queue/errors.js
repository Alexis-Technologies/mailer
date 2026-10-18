// Not ported: the error of ./queue, with a stable `code`: a job enqueued
// again under its key for another message, or a job that is not one.

/**
 * A failure of the queue: `queue.key_reused`, `queue.invalid_job`,
 * `queue.unsupported_version` or `queue.hash_mismatch`.
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
