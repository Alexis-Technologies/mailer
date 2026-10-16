// Ported from upyo v0.7.0 (packages/jmap/src/sendmany.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { JmapTransport } = require('../../src/jmap/jmap-transport.js');
const { requestUrl } = require('../helpers/jmap/request-url.js');

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

describe('sendMany batch - success', () => {
  it('should batch multiple messages into a single JMAP request', async () => {
    const originalFetch = globalThis.fetch;

    try {
      const requests = [];
      globalThis.fetch = (input, init) => {
        const url = requestUrl(input);

        const body = init?.body ? JSON.parse(init.body) : null;
        requests.push({ url, body });

        // Session fetch
        if (url.includes('.well-known/jmap')) {
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
              { status: 200 },
            ),
          );
        }

        // Mailbox/get
        if (body?.methodCalls?.[0]?.[0] === 'Mailbox/get') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                methodResponses: [
                  [
                    'Mailbox/get',
                    {
                      list: [
                        {
                          id: 'drafts-123',
                          role: 'drafts',
                          name: 'Drafts',
                        },
                      ],
                    },
                    'c0',
                  ],
                ],
              }),
              { status: 200 },
            ),
          );
        }

        // Identity/get
        if (body?.methodCalls?.[0]?.[0] === 'Identity/get') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                methodResponses: [
                  [
                    'Identity/get',
                    {
                      list: [
                        {
                          id: 'id-1',
                          email: 'sender@example.com',
                          name: 'Sender',
                        },
                      ],
                    },
                    'c0',
                  ],
                ],
              }),
              { status: 200 },
            ),
          );
        }

        // Batch Email/set + EmailSubmission/set
        if (body?.methodCalls?.[0]?.[0] === 'Email/set') {
          const emailCreates = body.methodCalls[0][1].create;
          const createdEmails = {};
          for (const key of Object.keys(emailCreates)) {
            createdEmails[key] = { id: `email-${key}` };
          }

          const submissionCreates = body.methodCalls[1][1].create;
          const createdSubmissions = {};
          for (const key of Object.keys(submissionCreates)) {
            createdSubmissions[key] = { id: `submission-${key}` };
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                methodResponses: [
                  ['Email/set', { created: createdEmails }, 'c0'],
                  ['EmailSubmission/set', { created: createdSubmissions }, 'c1'],
                ],
              }),
              { status: 200 },
            ),
          );
        }

        return Promise.resolve(new Response('Not found', { status: 404 }));
      };

      const transport = new JmapTransport({
        sessionUrl: 'https://jmap.example.com/.well-known/jmap',
        bearerToken: 'test-token',
        retries: 0,
        timeout: 5000,
      });

      const messages = [
        { ...baseMessage, subject: 'Test 1' },
        { ...baseMessage, subject: 'Test 2' },
        { ...baseMessage, subject: 'Test 3' },
      ];

      const receipts = [];
      for await (const receipt of transport.sendMany(messages)) {
        receipts.push(receipt);
      }

      // Verify all receipts are successful
      assert.equal(receipts.length, 3);
      assert.ok(receipts.every((r) => r.successful));

      // Verify batch request structure:
      // 1. Session fetch
      // 2. Mailbox/get (once)
      // 3. Identity/get (once)
      // 4. Batch Email/set + EmailSubmission/set (once for all messages)
      assert.equal(requests.length, 4, 'Should make exactly 4 requests');

      // Verify the batch request has all 3 emails
      const batchRequest = requests[3];
      const batchBody = batchRequest.body;
      const emailCreates = batchBody?.methodCalls?.[0]?.[1]?.create;
      assert.equal(Object.keys(emailCreates).length, 3, 'Email/set should have 3 creates');
      assert.ok('draft0' in emailCreates);
      assert.ok('draft1' in emailCreates);
      assert.ok('draft2' in emailCreates);

      // Verify submission creates reference the correct email IDs
      const submissionCreates = batchBody?.methodCalls?.[1]?.[1]?.create;
      assert.equal(
        Object.keys(submissionCreates).length,
        3,
        'EmailSubmission/set should have 3 creates',
      );
      assert.equal(submissionCreates.sub0.emailId, '#draft0');
      assert.equal(submissionCreates.sub1.emailId, '#draft1');
      assert.equal(submissionCreates.sub2.emailId, '#draft2');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('sendMany batch - partial failure', () => {
  it('should handle partial failures in batch', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (input, init) => {
        const url = requestUrl(input);

        const body = init?.body ? JSON.parse(init.body) : null;

        if (url.includes('.well-known/jmap')) {
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
              { status: 200 },
            ),
          );
        }

        if (body?.methodCalls?.[0]?.[0] === 'Mailbox/get') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                methodResponses: [
                  [
                    'Mailbox/get',
                    {
                      list: [
                        {
                          id: 'drafts-123',
                          role: 'drafts',
                          name: 'Drafts',
                        },
                      ],
                    },
                    'c0',
                  ],
                ],
              }),
              { status: 200 },
            ),
          );
        }

        if (body?.methodCalls?.[0]?.[0] === 'Identity/get') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                methodResponses: [
                  [
                    'Identity/get',
                    {
                      list: [{ id: 'id-1', email: 'sender@example.com' }],
                    },
                    'c0',
                  ],
                ],
              }),
              { status: 200 },
            ),
          );
        }

        // Batch with partial failure: draft1 fails
        if (body?.methodCalls?.[0]?.[0] === 'Email/set') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                methodResponses: [
                  [
                    'Email/set',
                    {
                      created: {
                        draft0: { id: 'email-0' },
                        draft2: { id: 'email-2' },
                      },
                      notCreated: {
                        draft1: {
                          type: 'invalidProperties',
                          description: 'Invalid recipient',
                        },
                      },
                    },
                    'c0',
                  ],
                  [
                    'EmailSubmission/set',
                    {
                      created: {
                        sub0: { id: 'submission-0' },
                        sub2: { id: 'submission-2' },
                      },
                      notCreated: {
                        sub1: {
                          type: 'invalidEmail',
                          description: 'Email not created',
                        },
                      },
                    },
                    'c1',
                  ],
                ],
              }),
              { status: 200 },
            ),
          );
        }

        return Promise.resolve(new Response('Not found', { status: 404 }));
      };

      const transport = new JmapTransport({
        sessionUrl: 'https://jmap.example.com/.well-known/jmap',
        bearerToken: 'test-token',
        retries: 0,
        timeout: 5000,
      });

      const messages = [
        { ...baseMessage, subject: 'Test 1' },
        { ...baseMessage, subject: 'Test 2' },
        { ...baseMessage, subject: 'Test 3' },
      ];

      const receipts = [];
      for await (const receipt of transport.sendMany(messages)) {
        receipts.push(receipt);
      }

      assert.equal(receipts.length, 3);

      // First message: success
      assert.ok(receipts[0].successful);
      assert.equal(receipts[0].messageId, 'submission-0');

      // Second message: failure
      assert.ok(!receipts[1].successful);
      const failedReceipt = receipts[1];
      assert.ok(failedReceipt.errorMessages.some((e) => e.includes('invalidProperties')));

      // Third message: success
      assert.ok(receipts[2].successful);
      assert.equal(receipts[2].messageId, 'submission-2');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('sendMany batch - attachment upload timeout', () => {
  it('should return retryable timeout receipts', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (input, init) => {
        const url = requestUrl(input);

        const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;

        if (url.includes('.well-known/jmap')) {
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
              { status: 200 },
            ),
          );
        }

        if (body?.methodCalls?.[0]?.[0] === 'Mailbox/get') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                methodResponses: [
                  [
                    'Mailbox/get',
                    {
                      list: [
                        {
                          id: 'drafts-123',
                          role: 'drafts',
                          name: 'Drafts',
                        },
                      ],
                    },
                    'c0',
                  ],
                ],
              }),
              { status: 200 },
            ),
          );
        }

        if (body?.methodCalls?.[0]?.[0] === 'Identity/get') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                methodResponses: [
                  [
                    'Identity/get',
                    {
                      list: [{ id: 'id-1', email: 'sender@example.com' }],
                    },
                    'c0',
                  ],
                ],
              }),
              { status: 200 },
            ),
          );
        }

        if (url.includes('/upload/')) {
          return new Promise((_resolve, reject) => {
            assert.ok(init?.signal instanceof AbortSignal);
            init.signal.addEventListener(
              'abort',
              () => {
                reject(init.signal?.reason);
              },
              { once: true },
            );
          });
        }

        return Promise.resolve(new Response('Not found', { status: 404 }));
      };

      const transport = new JmapTransport({
        sessionUrl: 'https://jmap.example.com/.well-known/jmap',
        bearerToken: 'test-token',
        retries: 0,
        timeout: 1,
      });

      const messages = [
        {
          ...baseMessage,
          attachments: [
            {
              filename: 'timeout.txt',
              contentType: 'text/plain',
              content: new Uint8Array([1, 2, 3]),
              contentId: 'timeout-attachment',
              inline: false,
            },
          ],
        },
      ];

      const receipts = [];
      for await (const receipt of transport.sendMany(messages)) {
        receipts.push(receipt);
      }

      assert.equal(receipts.length, 1);
      const receipt = receipts[0];
      assert.ok(!receipt.successful);
      if (!receipt.successful) {
        assert.equal(receipt.provider, 'jmap');
        assert.equal(receipt.retryable, true);
        assert.equal(receipt.errors?.[0]?.category, 'timeout');
        assert.equal(receipt.errors?.[0]?.retryable, true);
        assert.equal(receipt.errors?.[0]?.code, 'abort');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('sendMany batch - empty', () => {
  it('should yield empty for no messages', async () => {
    const transport = new JmapTransport({
      sessionUrl: 'https://jmap.example.com/.well-known/jmap',
      bearerToken: 'test-token',
    });

    const receipts = [];
    for await (const receipt of transport.sendMany([])) {
      receipts.push(receipt);
    }

    assert.equal(receipts.length, 0);
  });
});
