// The root entry: the message model and the transport contract ported from
// @upyo/core 0.7.0 (src/core/), in upstream's order.
const { formatAddress, parseAddress, isEmailAddress } = require('./core/address.js');
const { combineSignals } = require('./core/abort-signal.js');
const {
  isAttachment,
  iterateAttachmentContent,
  readAttachmentContent,
} = require('./core/attachment.js');
const {
  parseCalendarMethod,
  resolveCalendarContent,
  createCalendarAttachment,
} = require('./core/calendar.js');
const { createMessage } = require('./core/message.js');
const {
  generateMessageId,
  parseMessageId,
  formatMessageId,
  resolveThreadingHeaders,
} = require('./core/message-id.js');
const { comparePriority } = require('./core/priority.js');
const {
  classifyHttpStatus,
  classifyReceiptError,
  createReceiptError,
  createFailedReceipt,
  parseRetryAfter,
} = require('./core/receipt.js');
const { isRawTransport, isVerifiableTransport } = require('./core/transport.js');
const {
  RawMessageValidationError,
  createRawMessagePlan,
  iterateRawMessage,
  analyzeRawMessage,
} = require('./core/raw-message.js');

module.exports = {
  formatAddress,
  parseAddress,
  isEmailAddress,
  combineSignals,
  isAttachment,
  iterateAttachmentContent,
  readAttachmentContent,
  parseCalendarMethod,
  resolveCalendarContent,
  createCalendarAttachment,
  createMessage,
  generateMessageId,
  parseMessageId,
  formatMessageId,
  resolveThreadingHeaders,
  comparePriority,
  classifyHttpStatus,
  classifyReceiptError,
  createReceiptError,
  createFailedReceipt,
  parseRetryAfter,
  isRawTransport,
  isVerifiableTransport,
  RawMessageValidationError,
  createRawMessagePlan,
  iterateRawMessage,
  analyzeRawMessage,
};
