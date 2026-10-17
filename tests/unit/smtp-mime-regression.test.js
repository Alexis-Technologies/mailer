// Ported from upyo v0.7.0 (packages/smtp/src/mime-regression.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessage } = require('../../src/core/message.js');
// Changed after the port: convertMessage, which src/ no longer uses (it streams
// a message), is a test helper now.
const { convertMessage } = require('../helpers/smtp/convert-message.js');

// Changed in the port: the transfer encoding is chosen by content, so short
// ASCII lines go 7bit, and a bare LF is written as CRLF.
for (const text of ['first\r\nsecond', 'a'.repeat(150), ('x'.repeat(60) + '\n').repeat(20)]) {
  test(`text body physical lines: ${JSON.stringify(text.slice(0, 20))}`, async () => {
    const { raw } = await convertMessage(
      createMessage({
        from: 'from@example.com',
        to: 'to@example.com',
        subject: 'Test',
        content: { text },
      }),
    );
    const body = raw.split('\r\n\r\n')[1];
    assert.ok(!/(?<!\r)\n/.test(body));
    assert.ok(body.split('\r\n').every((line) => line.length <= 76));
    const decoded = raw.includes('Content-Transfer-Encoding: quoted-printable')
      ? body
          .replace(/=\r\n/g, '')
          .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      : body;
    assert.equal(decoded, text.replace(/\r?\n/g, '\r\n'));
  });
}

test('reject an unfoldable inline Content-ID', async () => {
  await assert.rejects(
    convertMessage(
      createMessage({
        from: 'from@example.com',
        to: 'to@example.com',
        subject: 'Test',
        content: { text: 'Test' },
        attachments: {
          filename: 'a',
          contentType: 'text/plain',
          content: new Uint8Array(),
          inline: true,
          contentId: 'x'.repeat(1000),
        },
      }),
    ),
    RangeError,
  );
});
