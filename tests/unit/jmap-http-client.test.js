// Ported from upyo v0.7.0 (packages/jmap/src/http-client.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { describe, it, test } = require('node:test');
const assert = require('node:assert/strict');
const { JmapHttpClient } = require('../../src/jmap/http-client.js');
const { createJmapConfig } = require('../../src/jmap/config.js');
const { JmapApiError } = require('../../src/jmap/errors.js');

describe('JmapHttpClient', () => {
  const config = createJmapConfig({
    sessionUrl: 'https://jmap.example.com/.well-known/jmap',
    bearerToken: 'test-token',
    retries: 0, // Disable retries for tests
    timeout: 1000,
  });

  describe('constructor', () => {
    it('should create an instance with config', () => {
      const client = new JmapHttpClient(config);
      assert.ok(client);
    });
  });

  describe('fetchSession', () => {
    it('should fetch session with Bearer token auth', async () => {
      const originalFetch = globalThis.fetch;

      try {
        const captured = { headers: null };

        globalThis.fetch = (_input, init) => {
          captured.headers = new Headers(init?.headers);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                capabilities: {},
                accounts: {
                  'acc-1': {
                    name: 'Test',
                    isPersonal: true,
                    isReadOnly: false,
                    accountCapabilities: { 'urn:ietf:params:jmap:mail': {} },
                  },
                },
                primaryAccounts: {},
                username: 'test@example.com',
                apiUrl: 'https://jmap.example.com/api',
                downloadUrl: 'https://jmap.example.com/download/{blobId}',
                uploadUrl: 'https://jmap.example.com/upload/{accountId}',
                state: '123',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        };

        const client = new JmapHttpClient(config);
        const session = await client.fetchSession();

        assert.ok(captured.headers);
        assert.equal(captured.headers.get('Authorization'), 'Bearer test-token');
        assert.equal(session.apiUrl, 'https://jmap.example.com/api');
        assert.ok(session.accounts['acc-1']);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should throw JmapApiError on HTTP error', async () => {
      const originalFetch = globalThis.fetch;

      try {
        globalThis.fetch = () => {
          return Promise.resolve(new Response('Unauthorized', { status: 401 }));
        };

        const client = new JmapHttpClient(config);

        await assert.rejects(
          async () => await client.fetchSession(),
          (error) => {
            assert.ok(error instanceof JmapApiError);
            assert.equal(error.statusCode, 401);
            return true;
          },
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('executeRequest', () => {
    it('should send JMAP request with proper structure', async () => {
      const originalFetch = globalThis.fetch;

      try {
        let capturedBody = null;

        globalThis.fetch = (_input, init) => {
          if (init?.body) {
            capturedBody = JSON.parse(init.body);
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                methodResponses: [
                  [
                    'Email/set',
                    {
                      created: { draft: { id: 'email-1' } },
                    },
                    'c0',
                  ],
                ],
                sessionState: 'state-1',
              }),
              { status: 200 },
            ),
          );
        };

        const client = new JmapHttpClient(config);
        const response = await client.executeRequest('https://jmap.example.com/api', {
          using: ['urn:ietf:params:jmap:core'],
          methodCalls: [['Email/set', { accountId: 'acc-1' }, 'c0']],
        });

        assert.ok(capturedBody);
        assert.deepEqual(capturedBody.using, ['urn:ietf:params:jmap:core']);
        assert.ok(response.methodResponses);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should throw on 4xx errors without retry', async () => {
      const originalFetch = globalThis.fetch;
      let fetchCount = 0;

      try {
        globalThis.fetch = () => {
          fetchCount++;
          return Promise.resolve(new Response('Bad Request', { status: 400 }));
        };

        const clientWithRetries = new JmapHttpClient(
          createJmapConfig({
            sessionUrl: 'https://jmap.example.com/.well-known/jmap',
            bearerToken: 'test-token',
            retries: 3,
          }),
        );

        await assert.rejects(
          async () =>
            await clientWithRetries.executeRequest('https://jmap.example.com/api', {
              using: [],
              methodCalls: [],
            }),
          JmapApiError,
        );

        // Should not retry on 4xx errors
        assert.equal(fetchCount, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('abort signal', () => {
    it('should abort request when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const client = new JmapHttpClient(config);

      await assert.rejects(
        async () => await client.fetchSession(controller.signal),
        (error) => {
          return (
            error instanceof Error &&
            (error.name === 'AbortError' ||
              error.message.includes('aborted') ||
              error.message.includes('abort'))
          );
        },
      );
    });

    it('should preserve custom abort reasons during requests', async () => {
      const originalFetch = globalThis.fetch;
      const abortReason = new Error('Stop JMAP request.');
      const controller = new AbortController();

      try {
        globalThis.fetch = (_input, init) =>
          new Promise((_resolve, reject) => {
            assert.ok(init?.signal instanceof AbortSignal);
            init.signal.addEventListener(
              'abort',
              () => {
                reject(init.signal?.reason);
              },
              { once: true },
            );
            setTimeout(() => controller.abort(abortReason), 0);
          });

        const clientWithRetries = new JmapHttpClient(
          createJmapConfig({
            sessionUrl: 'https://jmap.example.com/.well-known/jmap',
            bearerToken: 'test-token',
            retries: 3,
          }),
        );
        const startedAt = Date.now();

        await assert.rejects(
          () =>
            clientWithRetries.executeRequest(
              'https://jmap.example.com/api',
              { using: [], methodCalls: [] },
              controller.signal,
            ),
          (error) => error === abortReason,
        );
        assert.ok(Date.now() - startedAt < 500);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

test('caller cancellation clears the retry backoff', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  let abortedAt = 0;
  // Changed after the port: the body is read from its stream rather than
  // through response.text(), so the abort is scheduled from fetch, to land
  // in the backoff that follows the 503.
  globalThis.fetch = () => {
    calls++;
    setTimeout(() => {
      abortedAt = Date.now();
      controller.abort('stop retry');
    }, 20);
    return Promise.resolve(new Response('Unavailable.', { status: 503 }));
  };
  try {
    const client = new JmapHttpClient(
      createJmapConfig({
        sessionUrl: 'https://example.com/session',
        bearerToken: 'token',
        retries: 3,
      }),
    );
    await assert.rejects(
      client.executeRequest(
        'https://example.com/api',
        {
          using: [],
          methodCalls: [],
        },
        controller.signal,
      ),
      (e) => e === 'stop retry',
    );
    assert.ok(
      Date.now() - abortedAt < 800,
      'Cancellation must not wait for the one-second retry backoff.',
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
