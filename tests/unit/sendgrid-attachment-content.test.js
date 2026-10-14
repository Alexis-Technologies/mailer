// Ported from upyo v0.7.0 (packages/sendgrid/src/attachment-content.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessage } = require('../../src/core/message.js');
const { createSendGridConfig } = require('../../src/sendgrid/config.js');
const { convertMessage } = require('../../src/sendgrid/message-converter.js');

test('closes sibling sources when one attachment conversion fails', async () => {
  let siblingSignal;
  const failure = new TypeError('Read failed.');
  const attachment = {
    filename: 'a',
    contentId: 'a',
    inline: false,
    contentType: 'application/octet-stream',
  };
  const mail = createMessage({
    from: 'from@example.com',
    to: 'to@example.com',
    subject: 'Test',
    content: { text: 'Test' },
    attachments: [
      {
        ...attachment,
        content: async function* () {
          yield new Uint8Array([1]);
          throw failure;
        },
      },
      {
        ...attachment,
        content: (signal) => {
          siblingSignal = signal;
          return {
            [Symbol.asyncIterator]() {
              return { next: () => new Promise(() => {}) };
            },
          };
        },
      },
    ],
  });
  await assert.rejects(
    convertMessage(mail, createSendGridConfig({ apiKey: 'SG.test' })),
    (error) => error === failure,
  );
  assert.ok(siblingSignal?.aborted);
});

test('collects large replayable attachments without argument overflow', async () => {
  const bytes = new Uint8Array(256 * 1024).fill(123);
  const config = createSendGridConfig({ apiKey: 'SG.test' });
  for (const content of [
    new Blob([bytes]),
    async function* () {
      yield bytes;
    },
  ]) {
    const result = await convertMessage(
      createMessage({
        from: 'from@example.com',
        to: 'to@example.com',
        subject: 'Test',
        content: { text: 'Test' },
        attachments: {
          inline: false,
          filename: 'large.bin',
          content,
          contentId: 'large',
          contentType: 'application/octet-stream',
        },
      }),
      config,
    );
    const encoded = result.attachments?.[0].content;
    assert.ok(encoded);
    assert.deepEqual(
      Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
      bytes,
    );
  }
});
