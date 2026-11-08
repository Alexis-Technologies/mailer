// Not ported: tests of ./google-chat against a stubbed fetch, the cases of
// thinwrap's spec of its Google Chat connector (the body of a webhook, its
// thread, the categories of its errors) rewritten for this transport, and
// those of the Chat app, its request id and the mentions.
const { test } = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync } = require('node:crypto');
const { createChannelMessage } = require('../../src/channels/index.js');
const { GoogleChatTransport } = require('../../src/google-chat/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const WEBHOOK =
  'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=ChatWebhookKey&token=ChatWebhookToken';
const ACCOUNT = {
  type: 'service_account',
  client_email: 'chat-app@app-1.iam.gserviceaccount.com',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }),
};
const transport = (config = {}) =>
  new GoogleChatTransport({
    webhookUrl: WEBHOOK,
    retries: 0,
    generateId: () => '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    ...config,
  });
const chat = (fields = {}) =>
  createChannelMessage({ channel: 'google-chat', text: 'Deployed *v1.2.3*', ...fields });
// The answers of Chat, the token endpoint of Google answered apart.
const stub = (t, answer) => {
  const posts = [];
  stubFetch(t, (request) => {
    if (request.url.startsWith('https://oauth2.googleapis.com/')) {
      return json({ access_token: 'ya29.chat-token', expires_in: 3600 });
    }
    posts.push(request);
    return answer(request, posts.length - 1);
  });
  return posts;
};
const created = (name = 'spaces/AAAA/messages/BBBB.BBBB') =>
  json({ name, thread: { name: 'spaces/AAAA/threads/CCCC' } });
const status = (code, name) =>
  json({ error: { code, message: `${name} message`, status: name } }, code);

test('Google Chat: a message to the webhook is its text, the name of the message its id', async (t) => {
  const posts = stub(t, () => created());
  const receipt = await transport().send(chat());
  assert.strictEqual(posts[0].url, WEBHOOK);
  assert.strictEqual(posts[0].headers.get('authorization'), null);
  assert.strictEqual(posts[0].redirect, 'manual');
  assert.deepStrictEqual(posts[0].json, { text: 'Deployed *v1.2.3*' });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: 'spaces/AAAA/messages/BBBB.BBBB',
    provider: 'google-chat',
    channel: 'google-chat',
    state: 'sent',
  });
  await transport().send(chat({ thread: 'deploy-42' }));
  assert.strictEqual(
    posts[1].url,
    `${WEBHOOK}&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`,
  );
  assert.deepStrictEqual(posts[1].json.thread, { threadKey: 'deploy-42' });
});

test('Google Chat: a picture and links are a card, the payload over them', async (t) => {
  const posts = stub(t, () => created());
  await transport().send(
    chat({
      media: [{ url: 'https://example.com/chart.png', caption: 'Errors' }],
      buttons: [{ type: 'url', text: 'Open', url: 'https://example.com/run/1' }],
      payload: { fallbackText: 'Deployed' },
    }),
  );
  assert.deepStrictEqual(posts[0].json, {
    text: 'Deployed *v1.2.3*',
    cardsV2: [
      {
        cardId: 'message',
        card: {
          sections: [
            {
              widgets: [
                { image: { imageUrl: 'https://example.com/chart.png', altText: 'Errors' } },
                {
                  buttonList: {
                    buttons: [
                      { text: 'Open', onClick: { openLink: { url: 'https://example.com/run/1' } } },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
    fallbackText: 'Deployed',
  });
});

test('Google Chat: only the mentions a message names notify', async (t) => {
  const posts = stub(t, () => created());
  const text = 'Hi <users/all> and <users/123> and <users/456>';
  await transport().send(chat({ text }));
  assert.strictEqual(posts[0].json.text, 'Hi <​users/all> and <​users/123> and <​users/456>');
  await transport().send(chat({ text, mentions: { everyone: true, users: ['123'] } }));
  assert.strictEqual(posts[1].json.text, 'Hi <users/all> and <users/123> and <​users/456>');
});

test('Google Chat: a message to a space goes through the app, under its request id', async (t) => {
  const posts = stub(t, (_request, index) => {
    if (index === 0) {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
      });
    }
    return created();
  });
  const app = transport({ webhookUrl: undefined, serviceAccount: ACCOUNT, retries: 1 });
  const receipt = await app.send(chat({ to: 'spaces/AAAA', idempotencyKey: 'deploy-42' }));
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(posts.length, 2, 'a lost answer sent again, the same');
  assert.strictEqual(posts[0].url, posts[1].url);
  const url = new URL(posts[0].url);
  assert.strictEqual(
    url.origin + url.pathname,
    'https://chat.googleapis.com/v1/spaces/AAAA/messages',
  );
  assert.match(url.searchParams.get('requestId'), /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  assert.strictEqual(posts[0].headers.get('authorization'), 'Bearer ya29.chat-token');
  await app.send(chat({ to: 'spaces/AAAA' }));
  assert.strictEqual(
    new URL(posts[2].url).searchParams.get('requestId'),
    '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  );
});

test('Google Chat: a refusal by its status, the webhook its credential', async (t) => {
  const cases = [
    [status(404, 'NOT_FOUND'), {}, 'auth'],
    [status(403, 'PERMISSION_DENIED'), {}, 'auth'],
    [status(400, 'INVALID_ARGUMENT'), {}, 'validation'],
    [status(429, 'RESOURCE_EXHAUSTED'), {}, 'rate-limit'],
    [status(404, 'NOT_FOUND'), { app: true }, 'invalid-recipient'],
    [status(403, 'PERMISSION_DENIED'), { app: true }, 'configuration'],
    [status(401, 'UNAUTHENTICATED'), { app: true }, 'auth'],
  ];
  for (const [response, { app }, category] of cases) {
    t.mock.restoreAll();
    stub(t, () => response.clone());
    const receipt = app
      ? await transport({ serviceAccount: ACCOUNT }).send(chat({ to: 'spaces/AAAA' }))
      : await transport().send(chat());
    assert.strictEqual(receipt.errors[0].category, category, `${category} ${app}`);
  }
  t.mock.restoreAll();
  const posts = stub(t, () => status(503, 'UNAVAILABLE'));
  const unknown = await transport({ retries: 3 }).send(chat());
  assert.strictEqual(unknown.deliveryUnknown, true, 'a webhook takes no key');
  assert.strictEqual(posts.length, 1);
  assert.ok(!JSON.stringify(unknown).includes('ChatWebhookToken'));
  t.mock.restoreAll();
  stub(t, () => json({}));
  assert.strictEqual((await transport().send(chat())).deliveryUnknown, true);
});

test('Google Chat: what a message of Chat cannot be fails before any request', async (t) => {
  const posts = stub(t, () => created());
  const cases = [
    [chat({ buttons: [{ type: 'reply', text: 'Ack', id: 'ack' }] }), 'unsupported', /opens a link/],
    [
      chat({ media: [{ url: 'https://example.com/a.pdf', contentType: 'application/pdf' }] }),
      'unsupported',
      /picture at its URL/,
    ],
    [
      chat({ media: [{ url: 'https://example.com/a.png' }, { url: 'https://example.com/b.png' }] }),
      'unsupported',
      /one picture/,
    ],
    [chat({ text: 'x'.repeat(32_001) }), 'validation', /32000 bytes/],
    [chat({ to: 'spaces/AAAA' }), 'validation', /has no serviceAccount/],
    // Before (C19): the space went into the path as written, so a # or a ?
    // moved the requestId out of the query, and ../ the token to another
    // method of the API.
    [chat({ to: 'spaces/AAA#' }), 'validation', /a space: spaces\/ and its id/],
    [chat({ to: 'spaces/AAA/messages?x=' }), 'validation', /a space/],
    [chat({ to: 'spaces/AAA/../../v1/users' }), 'validation', /a space/],
    [createChannelMessage({ channel: 'slack', text: 'x' }), 'unsupported', /not of slack/],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport().send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  const noWebhook = await transport({ webhookUrl: undefined, serviceAccount: ACCOUNT }).send(
    chat(),
  );
  assert.match(noWebhook.errorMessages[0], /has no webhookUrl/);
  assert.strictEqual(posts.length, 0);
});

test('Google Chat: the options are checked when made, the secrets never shown', () => {
  assert.throws(() => new GoogleChatTransport({}), /needs webhookUrl, serviceAccount or both/);
  assert.throws(() => transport({ webhookUrl: 'http://chat.example.com/x' }), TypeError);
  assert.throws(() => transport({ serviceAccount: 'json' }), /parsed JSON/);
  assert.throws(() => transport({ serviceAccount: { client_email: 'a@b' } }), TypeError);
  const shown = JSON.stringify(transport({ serviceAccount: ACCOUNT }));
  assert.ok(!shown.includes('ChatWebhookToken') && !shown.includes('PRIVATE KEY'));
});

test('Google Chat: verify lists a space of the app, a webhook alone verifies nothing', async (t) => {
  const posts = stub(t, () => json({ spaces: [] }));
  await transport().verify();
  assert.strictEqual(posts.length, 0);
  await transport({ serviceAccount: ACCOUNT }).verify();
  assert.strictEqual(posts[0].url, 'https://chat.googleapis.com/v1/spaces?pageSize=1');
  assert.strictEqual(posts[0].method, 'GET');
  t.mock.restoreAll();
  stub(t, () => status(403, 'PERMISSION_DENIED'));
  await assert.rejects(
    transport({ serviceAccount: ACCOUNT }).verify(),
    (error) => error.statusCode === 403,
  );
});
