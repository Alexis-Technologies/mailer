// Not ported: the entry of ./queue, messages sent through a queue: the mail
// queue, its handler for any driver, the job of a message, and the queue in
// memory and the polling driver a store's outbox is made of.

const { QueueLeaseLostError, createPollingDriver } = require('../internal/polling-driver.js');
const { MailQueueError } = require('./errors.js');
const { createMailJobHandler } = require('./handler.js');
const { MAIL_JOB_NAME, MAIL_JOB_VERSION, prepareMailJob } = require('./job.js');
const { createMailQueue } = require('./mail-queue.js');
const { createMemoryQueue } = require('./memory-queue.js');
const { parseMailJob } = require('./parse.js');

module.exports = {
  MAIL_JOB_NAME,
  MAIL_JOB_VERSION,
  MailQueueError,
  QueueLeaseLostError,
  createMailJobHandler,
  createMailQueue,
  createMemoryQueue,
  createPollingDriver,
  parseMailJob,
  prepareMailJob,
};
