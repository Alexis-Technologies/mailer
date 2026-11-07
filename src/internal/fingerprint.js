// Not ported: the fingerprint of a message under an idempotency key, so that a
// key used again for another message is refused rather than answered with the
// receipt of the first.

const { createHash } = require('node:crypto');
const { updateCanonical } = require('./canonical-json.js');

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
  addMetadata(hash, message.metadata);
};

// A value of the JSON of a channel (a recipient of Web Push, a payload, a
// template) in its canonical form, so that the order of its keys does not
// make another message of it.
const addCanonical = (hash, label, value) => {
  hash.update(`${label}\u0000`);
  if (value !== undefined) updateCanonical(hash, value);
  hash.update('\u0000');
};

const addMetadata = (hash, metadata) => {
  if (metadata === undefined) return;
  const keys = Object.keys(metadata).toSorted();
  for (const key of keys) addValue(hash, `metadata ${key}`, metadata[key]);
};

// A message of a channel, after a first label that no email message has, so
// that the two never meet: what it says, its media by their URL or id, type
// and name (not their bytes); neither its idempotency key, which an attempt
// may set (pinMessageId), nor its tenant or the end of its validity.
const addChannelMessage = (hash, message) => {
  hash.update(`channel\u0000${message.channel}\u0000`);
  addValue(hash, 'from', message.from);
  addCanonical(hash, 'to', message.to);
  addValue(hash, 'text', message.text);
  if (message.media !== undefined) {
    for (const medium of message.media) {
      addValue(hash, 'medium', [
        medium.url ?? null,
        medium.id ?? null,
        medium.contentType ?? null,
        medium.filename ?? null,
        medium.caption ?? null,
      ]);
    }
  }
  addCanonical(hash, 'buttons', message.buttons);
  addCanonical(hash, 'template', message.template);
  addCanonical(hash, 'mentions', message.mentions);
  addCanonical(hash, 'payload', message.payload);
  addValue(hash, 'thread', message.thread);
  addValue(hash, 'title', message.title);
  addCanonical(hash, 'data', message.data);
  addValue(hash, 'priority', message.priority);
  addValue(hash, 'tags', message.tags);
  addValue(hash, 'scheduled-at', message.scheduledAt?.toISOString());
  addMetadata(hash, message.metadata);
};

/**
 * The SHA-256 of what a message says: its addresses, subject, body, header
 * fields, the names and types of its attachments (not their bytes), its
 * threading, schedule, tracking and metadata; for a raw message, its
 * envelope; for a message of a channel, its recipient and what it sends.
 * Its Message-ID and Date are left out, as an attempt may set them, and so
 * are its tenant and its channel when it is email, so that a key reserved by
 * 1.2 finds its message after the upgrade.
 *
 * @param message A message, a raw message or a message of a channel.
 * @returns The fingerprint, in hexadecimal.
 * @internal
 */
const fingerprintOf = (message) => {
  const hash = createHash('sha256');
  if (typeof message.channel === 'string' && message.channel !== 'email') {
    addChannelMessage(hash, message);
  } else if (message.envelope !== undefined && message.recipients === undefined) {
    addValue(hash, 'raw', [message.envelope.from, message.envelope.to]);
  } else {
    addMessage(hash, message);
  }
  return hash.digest('hex');
};

module.exports = { fingerprintOf };
