// Ported from upyo v0.7.0 (packages/maileroo/src/maileroo-transport.e2e.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { MailerooTransport } = require('../../src/maileroo/maileroo-transport.js');
const {
  createTestMessage,
  getTestConfig,
  isE2eTestingEnabled,
} = require('../helpers/maileroo/test-config.js');

const describeE2E = isE2eTestingEnabled() ? describe : describe.skip;
let e2eChain = Promise.resolve();

describeE2E('MailerooTransport E2E', { concurrency: false }, () => {
  const waitForRateLimit = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
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

  it('sends a simple text email', async () => {
    await runE2e(async () => {
      await waitForRateLimit();

      const transport = new MailerooTransport(getTestConfig().maileroo);
      const receipt = await transport.send(
        createTestMessage({
          subject: '[E2E] Maileroo text email',
          content: { text: 'This is a Maileroo E2E test email.' },
        }),
      );

      assertSuccessfulReceipt(receipt);
      console.log(`Sent Maileroo text email with ID: ${receipt.messageId}`);
    });
  });

  it('sends an HTML email', async () => {
    await runE2e(async () => {
      await waitForRateLimit();

      const transport = new MailerooTransport(getTestConfig().maileroo);
      const receipt = await transport.send(
        createTestMessage({
          subject: '[E2E] Maileroo HTML email',
          content: {
            html: '<h1>Hello from Upyo</h1><p>This is a Maileroo test.</p>',
            text: 'Hello from Upyo\n\nThis is a Maileroo test.',
          },
        }),
      );

      assertSuccessfulReceipt(receipt);
      console.log(`Sent Maileroo HTML email with ID: ${receipt.messageId}`);
    });
  });

  it('sends an email with an attachment', async () => {
    await runE2e(async () => {
      await waitForRateLimit();

      const transport = new MailerooTransport(getTestConfig().maileroo);
      const receipt = await transport.send(
        createTestMessage({
          subject: '[E2E] Maileroo attachment email',
          content: { text: 'This Maileroo E2E test email has an attachment.' },
          attachments: [
            {
              filename: 'maileroo-e2e.txt',
              contentType: 'text/plain',
              content: new TextEncoder().encode(
                'This attachment was sent by the Upyo Maileroo E2E test.',
              ),
              inline: false,
              contentId: '',
            },
          ],
        }),
      );

      assertSuccessfulReceipt(receipt);
      console.log(`Sent Maileroo attachment email with ID: ${receipt.messageId}`);
    });
  });

  it('sends an email with custom headers, tags, and tracking', async () => {
    await runE2e(async () => {
      await waitForRateLimit();

      const headers = new Headers();
      headers.set('X-Upyo-E2E', 'maileroo');

      const transport = new MailerooTransport({
        ...getTestConfig().maileroo,
        tracking: true,
        tags: { source: 'upyo-e2e' },
      });
      const receipt = await transport.send(
        createTestMessage({
          subject: '[E2E] Maileroo metadata email',
          content: { text: 'This Maileroo E2E test email has metadata.' },
          headers,
          tags: ['metadata'],
        }),
      );

      assertSuccessfulReceipt(receipt);
      console.log(`Sent Maileroo metadata email with ID: ${receipt.messageId}`);
    });
  });

  it('sends multiple emails with sendMany', async () => {
    await runE2e(async () => {
      await waitForRateLimit();

      const transport = new MailerooTransport(getTestConfig().maileroo);
      const receipts = [];

      for await (const receipt of transport.sendMany([
        createTestMessage({
          subject: '[E2E] Maileroo sendMany email 1',
        }),
        createTestMessage({
          subject: '[E2E] Maileroo sendMany email 2',
        }),
      ])) {
        receipts.push(receipt);
        await waitForRateLimit();
      }

      assert.equal(receipts.length, 2);
      for (const receipt of receipts) {
        assertSuccessfulReceipt(receipt);
      }
      console.log(
        `Sent Maileroo sendMany emails with IDs: ${receipts
          .map((receipt) => (receipt.successful ? receipt.messageId : 'failed'))
          .join(', ')}`,
      );
    });
  });
});
