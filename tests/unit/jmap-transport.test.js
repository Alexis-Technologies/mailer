// Ported from upyo v0.7.0 (packages/jmap/src/jmap-transport.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JmapTransport } = require('../../src/jmap/jmap-transport.js');

const baseMessage = {
  sender: { address: 'sender@example.com' },
  recipients: [{ address: 'recipient@example.com' }],
  ccRecipients: [],
  bccRecipients: [],
  replyRecipients: [],
  attachments: [],
  subject: 'Test Subject',
  content: { text: 'Hello, World!' },
  priority: 'normal',
  tags: [],
  headers: new Headers(),
};

describe('JmapTransport', () => {
  describe('constructor', () => {
    it('should create transport with config', () => {
      const transport = new JmapTransport({
        sessionUrl: 'https://jmap.example.com/.well-known/jmap',
        bearerToken: 'test-token',
      });

      assert.ok(transport);
      assert.equal(transport.config.sessionUrl, 'https://jmap.example.com/.well-known/jmap');
    });
  });

  describe('send', () => {
    it('should reject already-aborted signals', async () => {
      const controller = new AbortController();
      controller.abort();

      const transport = new JmapTransport({
        sessionUrl: 'https://jmap.example.com/.well-known/jmap',
        bearerToken: 'test-token',
      });

      await assert.rejects(
        () => transport.send(baseMessage, { signal: controller.signal }),
        (error) => error instanceof Error && error.name === 'AbortError',
      );
    });

    it('should reject already-aborted signals with custom reasons', async () => {
      const controller = new AbortController();
      controller.abort('stop');

      const transport = new JmapTransport({
        sessionUrl: 'https://jmap.example.com/.well-known/jmap',
        bearerToken: 'test-token',
      });

      await assert.rejects(
        () => transport.send(baseMessage, { signal: controller.signal }),
        (error) => error === 'stop',
      );
    });

    it('should reject caller aborts during fetch', async () => {
      const originalFetch = globalThis.fetch;
      const controller = new AbortController();

      try {
        globalThis.fetch = (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              },
              { once: true },
            );
            setTimeout(() => controller.abort(), 0);
          });

        const transport = new JmapTransport({
          sessionUrl: 'https://jmap.example.com/.well-known/jmap',
          bearerToken: 'test-token',
          retries: 0,
        });

        await assert.rejects(
          () => transport.send(baseMessage, { signal: controller.signal }),
          (error) => error instanceof Error && error.name === 'AbortError',
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should reject caller aborts with AbortError without a reason', async () => {
      const originalFetch = globalThis.fetch;
      const controller = new AbortController();
      Object.defineProperty(controller.signal, 'reason', {
        value: undefined,
      });

      try {
        globalThis.fetch = (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                // oxlint-disable-next-line prefer-promise-reject-errors -- upstream
                reject(undefined);
              },
              { once: true },
            );
            setTimeout(() => controller.abort(), 0);
          });

        const transport = new JmapTransport({
          sessionUrl: 'https://jmap.example.com/.well-known/jmap',
          bearerToken: 'test-token',
          retries: 0,
        });

        await assert.rejects(
          () => transport.send(baseMessage, { signal: controller.signal }),
          (error) => error instanceof Error && error.name === 'AbortError',
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should not expose network errors as reasonless caller aborts', async () => {
      const originalFetch = globalThis.fetch;
      const controller = new AbortController();
      Object.defineProperty(controller.signal, 'reason', {
        value: undefined,
      });

      try {
        globalThis.fetch = (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                reject(new TypeError('fetch failed'));
              },
              { once: true },
            );
            setTimeout(() => controller.abort(), 0);
          });

        const transport = new JmapTransport({
          sessionUrl: 'https://jmap.example.com/.well-known/jmap',
          bearerToken: 'test-token',
          retries: 0,
        });

        await assert.rejects(
          () => transport.send(baseMessage, { signal: controller.signal }),
          (error) =>
            error instanceof Error &&
            error.name === 'AbortError' &&
            error.message !== 'fetch failed',
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('sendMany', () => {
    it('should reject already-aborted signals with custom reasons', async () => {
      const controller = new AbortController();
      controller.abort('stop');

      const transport = new JmapTransport({
        sessionUrl: 'https://jmap.example.com/.well-known/jmap',
        bearerToken: 'test-token',
      });

      await assert.rejects(
        async () => {
          // oxlint-disable-next-line no-underscore-dangle, no-unused-vars -- upstream
          for await (const _receipt of transport.sendMany([baseMessage], {
            signal: controller.signal,
          })) {
            // Consume the async iterable to trigger sendMany().
          }
        },
        (error) => error === 'stop',
      );
    });
  });
});

// Note: Complex tests with fetch mocking are in separate files:
// - send-success.test.ts (successful send test)
// - send-error.test.ts (error handling test)
// - sendmany.test.ts (sendMany tests)
// This avoids test interference issues with globalThis.fetch mocking
