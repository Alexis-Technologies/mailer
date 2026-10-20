// Not ported: the fingerprint of a message under an idempotency key, so that a
// key used again for another message is refused rather than answered with the
// receipt of the first.

const { createHash } = require('node:crypto');

const addAddresses = (hash, label, addresses) => {
  hash.update(`${label}\u0000`);
  for (const address of addresses) {
    hash.update(`${address.name ?? ''}\u0001${address.address}\u0000`);
  }
};

const addValue = (hash, label, value) => {
  hash.update(`${label}\u0000${JSON.stringify(value) ?? ''}\u0000`);
};

const addMessage = (hash, message) => {
  addAddresses(hash, 'from', [message.sender]);
  addAddresses(hash, 'to', message.recipients);
  addAddresses(hash, 'cc', message.ccRecipients);
  addAddresses(hash, 'bcc', message.bccRecipients);
  addAddresses(hash, 'reply-to', message.replyRecipients);
  addValue(hash, 'subject', message.subject);
  addValue(hash, 'text', message.content.text);
  addValue(hash, 'html', message.content.html);
  addValue(hash, 'priority', message.priority);
  addValue(hash, 'tags', message.tags);
  // Headers iterate in the order of their lowercased names.
  for (const [name, value] of message.headers) addValue(hash, `header ${name}`, value);
  for (const attachment of message.attachments) {
    addValue(hash, 'attachment', [
      attachment.filename,
      attachment.contentType,
      attachment.inline,
      attachment.contentId,
    ]);
  }
  addValue(hash, 'in-reply-to', message.inReplyTo);
  addValue(hash, 'references', message.references);
  addValue(hash, 'calendar', message.calendar);
  addValue(hash, 'scheduled-at', message.scheduledAt?.toISOString());
  addValue(hash, 'tracking', message.tracking);
  if (message.metadata !== undefined) {
    const keys = Object.keys(message.metadata).toSorted();
    for (const key of keys) addValue(hash, `metadata ${key}`, message.metadata[key]);
  }
};

/**
 * The SHA-256 of what a message says: its addresses, subject, body, header
 * fields, the names and types of its attachments (not their bytes), its
 * threading, schedule, tracking and metadata; for a raw message, its
 * envelope.  Its Message-ID and Date are left out, as an attempt may set them.
 *
 * @param message A message or a raw message.
 * @returns The fingerprint, in hexadecimal.
 * @internal
 */
const fingerprintOf = (message) => {
  const hash = createHash('sha256');
  if (message.envelope !== undefined && message.recipients === undefined) {
    addValue(hash, 'raw', [message.envelope.from, message.envelope.to]);
  } else {
    addMessage(hash, message);
  }
  return hash.digest('hex');
};

module.exports = { fingerprintOf };
