// Ported from upyo v0.7.0 (packages/ses/src/attachment-content.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessage } = require('../../src/core/message.js');
const { createSesConfig } = require('../../src/ses/config.js');
const { convertMessage } = require('../../src/ses/message-converter.js');

test('collects large replayable attachments without argument overflow', async () => {
  const bytes = new Uint8Array(256 * 1024).fill(123);
  const config = createSesConfig({
    authentication: {
      type: 'credentials',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
  });
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
    const encoded = result.Content.Simple?.Attachments?.[0].RawContent;
    assert.ok(encoded);
    assert.deepEqual(
      Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
      bytes,
    );
  }
});
