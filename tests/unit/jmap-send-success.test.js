// Ported from upyo v0.7.0 (packages/jmap/src/send-success.test.ts)
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

describe('JmapTransport send success', () => {
  it('should return successful receipt on success', async () => {
    const originalFetch = globalThis.fetch;

    try {
      const fetchInfo = { count: 0 };
      globalThis.fetch = (input, _init) => {
        fetchInfo.count++;
        const url = requestUrl(input);

        // First call: session fetch
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
                primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acc-1' },
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

        // Second call: Mailbox/get for drafts
        if (fetchInfo.count === 2) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                methodResponses: [
                  [
                    'Mailbox/get',
                    {
                      list: [{ id: 'drafts-123', role: 'drafts', name: 'Drafts' }],
                    },
                    'c0',
                  ],
                ],
              }),
              { status: 200 },
            ),
          );
        }

        // Third call: Identity/get
        if (fetchInfo.count === 3) {
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

        // Fourth call: Email/set + EmailSubmission/set
        return Promise.resolve(
          new Response(
            JSON.stringify({
              methodResponses: [
                [
                  'Email/set',
                  {
                    created: { draft: { id: 'email-123' } },
                  },
                  'c0',
                ],
                [
                  'EmailSubmission/set',
                  {
                    created: { submission: { id: 'sub-456' } },
                  },
                  'c1',
                ],
              ],
            }),
            { status: 200 },
          ),
        );
      };

      const transport = new JmapTransport({
        sessionUrl: 'https://jmap.example.com/.well-known/jmap',
        bearerToken: 'test-token',
        retries: 0,
        timeout: 1000,
      });

      const receipt = await transport.send(baseMessage);

      assert.equal(receipt.successful, true);
      if (receipt.successful) {
        assert.ok(receipt.messageId);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
