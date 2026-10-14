// Ported from upyo v0.7.0 (packages/jmap/src/blob-uploader.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { uploadBlob } = require('../../src/jmap/blob-uploader.js');
const { createJmapConfig } = require('../../src/jmap/config.js');

describe('uploadBlob', () => {
  const config = createJmapConfig({
    sessionUrl: 'https://jmap.example.com/.well-known/jmap',
    bearerToken: 'test-token',
    retries: 0,
    timeout: 1000,
  });

  it('should upload a blob and return blobId', async () => {
    const originalFetch = globalThis.fetch;

    try {
      const capturedRequest = {
        url: '',
        headers: new Headers(),
        body: new Blob(),
      };

      globalThis.fetch = (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        capturedRequest.url = url;
        capturedRequest.headers = new Headers(init?.headers);
        capturedRequest.body = init?.body;

        return Promise.resolve(
          new Response(
            JSON.stringify({
              accountId: 'acc-1',
              blobId: 'blob-123',
              type: 'image/png',
              size: 1024,
            }),
            { status: 201 },
          ),
        );
      };

      const blob = new Blob(['test content'], { type: 'image/png' });
      const result = await uploadBlob(
        config,
        'https://jmap.example.com/upload/{accountId}',
        'acc-1',
        blob,
      );

      assert.equal(capturedRequest.url, 'https://jmap.example.com/upload/acc-1');
      assert.equal(capturedRequest.headers.get('Authorization'), 'Bearer test-token');
      assert.equal(capturedRequest.headers.get('Content-Type'), 'image/png');

      assert.equal(result.blobId, 'blob-123');
      assert.equal(result.type, 'image/png');
      assert.equal(result.size, 1024);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should handle File objects with name', async () => {
    const originalFetch = globalThis.fetch;

    try {
      const capturedHeaders = { value: new Headers() };

      globalThis.fetch = (_input, init) => {
        capturedHeaders.value = new Headers(init?.headers);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accountId: 'acc-1',
              blobId: 'blob-456',
              type: 'application/pdf',
              size: 2048,
            }),
            { status: 201 },
          ),
        );
      };

      const file = new File(['pdf content'], 'document.pdf', {
        type: 'application/pdf',
      });
      const result = await uploadBlob(
        config,
        'https://jmap.example.com/upload/{accountId}',
        'acc-1',
        file,
      );

      assert.equal(capturedHeaders.value.get('Content-Type'), 'application/pdf');
      assert.equal(result.blobId, 'blob-456');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should throw on upload failure', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = () => {
        return Promise.resolve(new Response('Unauthorized', { status: 401 }));
      };

      const blob = new Blob(['test'], { type: 'text/plain' });

      await assert.rejects(
        async () =>
          await uploadBlob(config, 'https://jmap.example.com/upload/{accountId}', 'acc-1', blob),
        (error) => {
          assert.ok(error.message.includes('401'));
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should respect abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const blob = new Blob(['test'], { type: 'text/plain' });

    await assert.rejects(
      async () =>
        await uploadBlob(
          config,
          'https://jmap.example.com/upload/{accountId}',
          'acc-1',
          blob,
          controller.signal,
        ),
      (error) => {
        return (
          error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('abort')
        );
      },
    );
  });
});
