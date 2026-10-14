// Ported from upyo v0.7.0 (packages/mailtrap/src/mailtrap-transport.e2e.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { MailtrapTransport } = require('../../src/mailtrap/mailtrap-transport.js');
const {
  createTestMessage,
  getTestConfig,
  isE2eTestingEnabled,
} = require('../helpers/mailtrap/test-config.js');

const describeE2E = isE2eTestingEnabled() ? describe : describe.skip;
let e2eChain = Promise.resolve();

describeE2E('MailtrapTransport E2E', { concurrency: false }, () => {
  const waitForRateLimit = async () => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  };

  const runE2e = async (callback) => {
    const previous = e2eChain;
    let release = () => {};
    e2eChain = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      return await callback();
    } finally {
      release();
    }
  };

  const assertSuccessfulReceipt = (receipt) => {
    assert.ok(
      receipt.successful,
      receipt.successful ? undefined : receipt.errorMessages.join(', '),
    );
    assert.ok(receipt.messageId);
  };

  it('sends a simple text email to sandbox', async () => {
    await runE2e(async () => {
      await waitForRateLimit();

      const transport = new MailtrapTransport(getTestConfig().mailtrap);
      const receipt = await transport.send(
        createTestMessage({
          subject: '[E2E] Mailtrap text email',
          content: { text: 'This is a Mailtrap E2E test email.' },
        }),
      );

      assertSuccessfulReceipt(receipt);
      console.log(`Sent Mailtrap text email with ID: ${receipt.messageId}`);
    });
  });

  it('sends an HTML email to sandbox', async () => {
    await runE2e(async () => {
      await waitForRateLimit();

      const transport = new MailtrapTransport(getTestConfig().mailtrap);
      const receipt = await transport.send(
        createTestMessage({
          subject: '[E2E] Mailtrap HTML email',
          content: {
            html: '<h1>Hello from Upyo</h1><p>This is a Mailtrap test.</p>',
            text: 'Hello from Upyo\n\nThis is a Mailtrap test.',
          },
        }),
      );

      assertSuccessfulReceipt(receipt);
      console.log(`Sent Mailtrap HTML email with ID: ${receipt.messageId}`);
    });
  });

  it('sends multiple emails via batch API', async () => {
    await runE2e(async () => {
      await waitForRateLimit();

      const transport = new MailtrapTransport(getTestConfig().mailtrap);
      const receipts = [];

      for await (const receipt of transport.sendMany([
        createTestMessage({
          subject: '[E2E] Mailtrap batch 1',
          content: { text: 'Batch message 1' },
        }),
        createTestMessage({
          subject: '[E2E] Mailtrap batch 2',
          content: { text: 'Batch message 2' },
        }),
      ])) {
        receipts.push(receipt);
      }

      assert.equal(receipts.length, 2);
      for (const receipt of receipts) {
        assertSuccessfulReceipt(receipt);
      }
    });
  });
});
