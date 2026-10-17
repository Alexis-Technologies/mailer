// Ported from upyo v0.7.0 (packages/opentelemetry/src/message-size.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createMessage } = require('../../src/core/message.js');
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { estimateMessageSize } = require('../../src/otel/message-size.js');

describe('estimateMessageSize()', () => {
  const base = {
    from: 'sender@example.com',
    to: 'recipient@example.net',
  };

  it('should count non-ASCII text in UTF-8 bytes', () => {
    // "점심" is two code units but six bytes, so counting code units would
    // report a size a third of the truth.
    const ascii = estimateMessageSize(
      createMessage({ ...base, subject: 'ab', content: { text: 'cd' } }),
    );
    const korean = estimateMessageSize(
      createMessage({ ...base, subject: '점심', content: { text: '식사' } }),
    );

    assert.equal(korean - ascii, 8);
  });

  it('should count an astral character as four bytes', () => {
    const empty = estimateMessageSize(
      createMessage({ ...base, subject: '', content: { text: '' } }),
    );
    const emoji = estimateMessageSize(
      createMessage({ ...base, subject: '', content: { text: '🍜' } }),
    );

    assert.equal(emoji - empty, 4);
  });

  it('should count the calendar payload', () => {
    const ics = ['BEGIN:VCALENDAR', 'METHOD:REQUEST', 'END:VCALENDAR'].join('\r\n') + '\r\n';
    const without = estimateMessageSize(
      createMessage({ ...base, subject: 's', content: { text: 't' } }),
    );
    // oxlint-disable-next-line no-underscore-dangle -- upstream
    const with_ = estimateMessageSize(
      createMessage({
        ...base,
        subject: 's',
        content: { text: 't' },
        calendar: { method: 'REQUEST', content: ics },
      }),
    );

    assert.equal(with_ - without, ics.length);
  });

  it('should count both bodies when the message carries text and HTML', () => {
    const size = estimateMessageSize(
      createMessage({
        ...base,
        subject: '',
        content: { html: '<p>hi</p>', text: 'hi' },
      }),
    );

    assert.equal(size, 500 + '<p>hi</p>'.length + 'hi'.length);
  });
});
