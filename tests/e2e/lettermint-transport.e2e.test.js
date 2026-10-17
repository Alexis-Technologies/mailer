// Ported from upyo v0.7.0 (packages/lettermint/src/lettermint-transport.e2e.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { LettermintTransport } = require('../../src/lettermint/lettermint-transport.js');
const {
  createTestMessage,
  getTestConfig,
  isE2eTestingEnabled,
} = require('../helpers/lettermint/test-config.js');

const describeE2E = isE2eTestingEnabled() ? describe : describe.skip;

describeE2E('LettermintTransport E2E', { concurrency: false }, () => {
  const waitForRateLimit = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  };

  const assertSuccessfulReceipt = (receipt) => {
    assert.equal(
      receipt.successful,
      true,
      receipt.successful ? undefined : receipt.errorMessages.join(', '),
    );
    assert.ok(receipt.messageId);
  };

  it('sends a simple text email', async () => {
    await waitForRateLimit();

    const transport = new LettermintTransport(getTestConfig().lettermint);
    const receipt = await transport.send(
      createTestMessage({
        subject: '[E2E] Lettermint text email',
        content: { text: 'This is a Lettermint E2E test email.' },
      }),
    );

    assertSuccessfulReceipt(receipt);
    console.log(`Sent Lettermint text email with ID: ${receipt.messageId}`);
  });

  it('sends an HTML email', async () => {
    await waitForRateLimit();

    const transport = new LettermintTransport(getTestConfig().lettermint);
    const receipt = await transport.send(
      createTestMessage({
        subject: '[E2E] Lettermint HTML email',
        content: {
          html: '<h1>Hello from Upyo</h1><p>This is a Lettermint test.</p>',
          text: 'Hello from Upyo\n\nThis is a Lettermint test.',
        },
      }),
    );

    assertSuccessfulReceipt(receipt);
    console.log(`Sent Lettermint HTML email with ID: ${receipt.messageId}`);
  });

  it('sends an email with an attachment', async () => {
    await waitForRateLimit();

    const transport = new LettermintTransport(getTestConfig().lettermint);
    const receipt = await transport.send(
      createTestMessage({
        subject: '[E2E] Lettermint attachment email',
        content: { text: 'This Lettermint E2E test email has an attachment.' },
        attachments: [
          {
            filename: 'lettermint-e2e.txt',
            contentType: 'text/plain',
            content: new TextEncoder().encode(
              'This attachment was sent by the Upyo Lettermint E2E test.',
            ),
            inline: false,
            contentId: '',
          },
        ],
      }),
    );

    assertSuccessfulReceipt(receipt);
    console.log(`Sent Lettermint attachment email with ID: ${receipt.messageId}`);
  });

  it('sends multiple emails with sendMany', async () => {
    await waitForRateLimit();

    const transport = new LettermintTransport(getTestConfig().lettermint);
    const receipts = [];

    for await (const receipt of transport.sendMany([
      createTestMessage({
        subject: '[E2E] Lettermint batch email 1',
      }),
      createTestMessage({
        subject: '[E2E] Lettermint batch email 2',
      }),
    ])) {
      receipts.push(receipt);
    }

    assert.equal(receipts.length, 2);
    for (const receipt of receipts) {
      assertSuccessfulReceipt(receipt);
    }
    console.log(
      `Sent Lettermint batch emails with IDs: ${receipts
        .map((receipt) => (receipt.successful ? receipt.messageId : 'failed'))
        .join(', ')}`,
    );
  });
});
