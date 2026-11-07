// Ported from upyo v0.7.0 (packages/opentelemetry/src/message-size.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Counts a string in UTF-8 bytes rather than UTF-16 code units.
 *
 * `String.prototype.length` counts code units, which undercounts every
 * character outside the Basic Latin block: a Korean subject is a third of its
 * real size, an emoji a half.  The size these estimates report is in bytes, so
 * they have to be counted that way.
 *
 * Counted with `Buffer.byteLength`, without encoding the text.
 *
 * @param text The string to measure.
 * @returns The number of bytes the string occupies in UTF-8.
 */
const utf8Length = (text) => {
  return Buffer.byteLength(text, 'utf8');
};

// The fields of a message of a channel that go as JSON, counted as such.
const JSON_FIELDS = ['buttons', 'payload', 'template', 'data'];

// What a message of a channel sends: its text and title, the JSON of its
// buttons, payload, template and data, and a flat guess per medium, which
// goes by its URL or id rather than its bytes.
const estimateChannelMessageSize = (message) => {
  let size = 0;
  if (message.text !== undefined) size += utf8Length(message.text);
  if (message.title !== undefined) size += utf8Length(message.title);
  for (const field of JSON_FIELDS) {
    if (message[field] !== undefined) size += utf8Length(JSON.stringify(message[field]));
  }
  if (message.media !== undefined) size += message.media.length * 100;
  return size;
};

/**
 * Estimates the wire size of a message, in bytes.
 *
 * This is an estimate, not a measurement: the header block is a flat guess, and
 * an attachment contributes only its framing rather than its content, which
 * would mean reading every attachment to report a span attribute.  What it does
 * count, it counts in the units it claims.  A message of a channel counts
 * what its provider is sent of it.
 *
 * @param message The message to measure, of email or of a channel.
 * @returns The estimated size in bytes.
 */
const estimateMessageSize = (message) => {
  if ((message.channel ?? 'email') !== 'email') return estimateChannelMessageSize(message);
  let size = 0;

  // Headers estimate (rough)
  size += 500;

  // Subject
  size += utf8Length(message.subject);

  // Content
  if ('html' in message.content) {
    size += utf8Length(message.content.html);
    if (message.content.text) {
      size += utf8Length(message.content.text);
    }
  } else {
    size += utf8Length(message.content.text);
  }

  // Calendar payload, which travels in full whichever way a transport
  // carries it
  if (message.calendar != null) {
    size += utf8Length(message.calendar.content);
  }

  // Attachments estimate (metadata only, not content)
  size += message.attachments.length * 100;

  return size;
};

module.exports = { estimateMessageSize };
