// Ported from upyo v0.7.0 (packages/mime/src/header-validation.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessage } = require('../../src/core/message.js');
const { composeMessage } = require('../../src/mime/index.js');
const { prepareMimeMessage } = require('../../src/mime/message.js');

const message = createMessage({
  from: 'from@example.com',
  to: 'to@example.com',
  subject: 'Test',
  content: { text: 'Hello' },
});

for (const address of [
  'reply@example.com\r\nBcc: injected@example.com',
  'reply@example.com\r',
  'reply@example.com\n',
]) {
  test(`reject address line endings: ${JSON.stringify(address)}`, async () => {
    const direct = {
      ...message,
      replyRecipients: [{ address }],
    };
    assert.throws(() => prepareMimeMessage(direct), TypeError);
    await assert.rejects(composeMessage(direct), TypeError);
  });
}

class DirectHeaders extends Headers {
  field;

  constructor(field) {
    super();
    this.field = field;
  }
  *[Symbol.iterator]() {
    yield [this.field, 'value'];
  }
}

for (const field of ['X-Test\r\nBcc', 'X-Test: Bcc', 'X Test', '', 'X-한글', 'X-Test\n']) {
  test(`reject invalid custom field name: ${JSON.stringify(field)}`, async () => {
    const direct = { ...message, headers: new DirectHeaders(field) };
    assert.throws(() => prepareMimeMessage(direct), TypeError);
    await assert.rejects(composeMessage(direct), TypeError);
  });
}

test('accept the full printable ASCII field-name range except colon', async () => {
  const field = Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33))
    .join('')
    .replace(':', '');
  await composeMessage({ ...message, headers: new DirectHeaders(field) });
});
