// Not ported: tests of ./telegram against a stubbed fetch, the cases of
// thinwrap's spec of its Telegram connector (the body of sendMessage, the
// categories of the refusals, the wait of a 429 in the body, a refusal in a
// 200) rewritten for this transport, and those of its media, buttons, limits
// and bugs.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { TelegramTransport } = require('../../src/telegram/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const transport = (config = {}) =>
  new TelegramTransport({ botToken: TOKEN, retries: 0, ...config });
const message = (fields = {}) =>
  createChannelMessage({ channel: 'telegram', to: 987654321, text: 'Hello', ...fields });
const ok = (result = { message_id: 12345, chat: { id: 987654321 } }) => json({ ok: true, result });
const refused = (status, description, parameters) =>
  json({ ok: false, error_code: status, description, ...(parameters && { parameters }) }, status);

test('Telegram: a text is a call of sendMessage, the token in its path, as JSON', async (t) => {
  const requests = stubFetch(t, () => ok());
  const receipt = await transport().send(message());
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].redirect, 'manual');
  assert.strictEqual(requests[0].headers.get('content-type'), 'application/json');
  assert.deepStrictEqual(requests[0].json, { chat_id: 987654321, text: 'Hello' });
  // The id of a message is one within its chat: the chat's goes first.
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: '987654321:12345',
    provider: 'telegram',
    channel: 'telegram',
    state: 'sent',
  });
});

test('Telegram: the fields of a message and its payload go to their keys of the call', async (t) => {
  const requests = stubFetch(t, () => ok({ message_id: 1 }));
  const receipt = await transport({ parseMode: 'MarkdownV2' }).send(
    message({
      to: '@channelname',
      text: '*Bold* text',
      thread: '7',
      priority: 'low',
      buttons: [
        { type: 'url', text: 'Open', url: 'https://example.com/' },
        { type: 'reply', text: 'Yes', id: 'answer:yes' },
      ],
      payload: {
        entities: [{ type: 'bold', offset: 0, length: 4 }],
        protect_content: true,
        reply_parameters: { message_id: 1 },
        link_preview_options: { is_disabled: true },
      },
    }),
  );
  assert.deepStrictEqual(requests[0].json, {
    chat_id: '@channelname',
    text: '*Bold* text',
    parse_mode: 'MarkdownV2',
    message_thread_id: 7,
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Open', url: 'https://example.com/' }],
        [{ text: 'Yes', callback_data: 'answer:yes' }],
      ],
    },
    disable_notification: true,
    entities: [{ type: 'bold', offset: 0, length: 4 }],
    protect_content: true,
    reply_parameters: { message_id: 1 },
    link_preview_options: { is_disabled: true },
  });
  // An answer of no chat names the message alone.
  assert.strictEqual(receipt.messageId, '1');
});

test('Telegram: a refusal is told by its description, its status and its body alike', async (t) => {
  // Changed in the port: thinwrap made every 403 an invalid recipient (T7).
  const cases = [
    [403, 'Forbidden: bot was blocked by the user', 'blocked', 'telegram.blocked'],
    [403, 'Forbidden: bot was kicked from the group chat', 'blocked', 'telegram.blocked'],
    [403, 'Forbidden: bot is not a member of the channel chat', 'blocked', 'telegram.blocked'],
    [
      403,
      "Forbidden: bot can't initiate conversation with a user",
      'not-on-channel',
      'telegram.not_started',
    ],
    [403, 'Forbidden: user is deactivated', 'invalid-recipient', 'telegram.deactivated'],
    [
      403,
      "Forbidden: bot can't send messages to bots",
      'invalid-recipient',
      'telegram.bot_recipient',
    ],
    [403, 'Forbidden: something new', 'blocked', 'telegram.forbidden'],
    [400, 'Bad Request: chat not found', 'invalid-recipient', 'telegram.chat_not_found'],
    [400, 'Bad Request: PEER_ID_INVALID', 'invalid-recipient', 'telegram.chat_not_found'],
    [
      400,
      'Bad Request: not enough rights to send text messages to the chat',
      'blocked',
      'telegram.no_rights',
    ],
    [400, 'Bad Request: message is too long', 'validation', 'telegram.invalid'],
    [400, 'Bad Request: something else', 'validation', 'telegram.bad_request'],
    [401, 'Unauthorized: invalid token specified', 'auth', 'telegram.unauthorized'],
    [404, 'Not Found', 'auth', 'telegram.unauthorized'],
  ];
  for (const [status, description, category, code] of cases) {
    // A refusal in a 200 is read as one, not as a success.
    for (const answerStatus of [status, 200]) {
      t.mock.restoreAll();
      stubFetch(t, () => json({ ok: false, error_code: status, description }, answerStatus));
      const receipt = await transport().send(message());
      const label = `${status} ${description} in ${answerStatus}`;
      assert.strictEqual(receipt.successful, false, label);
      assert.strictEqual(receipt.errors[0].category, category, label);
      assert.strictEqual(receipt.errors[0].code, code, label);
      assert.strictEqual(receipt.retryable, false, label);
      assert.strictEqual(receipt.deliveryUnknown, undefined, label);
      assert.strictEqual(receipt.channel, 'telegram', label);
    }
  }
});

test('Telegram: a group moved to a supergroup is an invalid recipient, its new id kept', async (t) => {
  stubFetch(t, () =>
    refused(400, 'Bad Request: group chat was upgraded to a supergroup chat', {
      migrate_to_chat_id: -1001234567890,
    }),
  );
  const receipt = await transport().send(message({ to: -4242 }));
  assert.strictEqual(receipt.errors[0].category, 'invalid-recipient');
  assert.strictEqual(receipt.errors[0].code, 'telegram.migrated');
  assert.strictEqual(
    receipt.errors[0].providerDetails.parameters.migrate_to_chat_id,
    -1001234567890,
  );
});

test('Telegram: a 429 waits the retry_after of its body, then sends again', async (t) => {
  // Telegram tells the wait in its body, not in Retry-After.
  const requests = stubFetch(t, (_request, index) =>
    index === 0 ? refused(429, 'Too Many Requests: retry after 0', { retry_after: 0 }) : ok(),
  );
  const heard = [];
  const receipt = await transport({ retries: 1 }).send(message(), {
    onRetry: (event) => heard.push(event.error.statusCode),
  });
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(requests.length, 2);
  assert.deepStrictEqual(heard, [429]);
  t.mock.restoreAll();
  stubFetch(t, () => refused(429, 'Too Many Requests: retry after 30', { retry_after: 30 }));
  const limited = await transport().send(message());
  assert.strictEqual(limited.errors[0].category, 'rate-limit');
  assert.strictEqual(limited.errors[0].retryAfterMilliseconds, 30_000);
  assert.strictEqual(limited.retryable, true);
});

test('Telegram: a 5xx or a timeout is not sent again, of unknown delivery', async (t) => {
  // Before (TG1): node-telegram-bot-api sent sendMessage again after a 5xx
  // and a timeout, after which Telegram may have sent the message.
  for (const status of [500, 502, 503]) {
    t.mock.restoreAll();
    const requests = stubFetch(t, () => new Response('Bad Gateway', { status }));
    const receipt = await transport({ retries: 3 }).send(message());
    assert.strictEqual(requests.length, 1, String(status));
    assert.strictEqual(receipt.deliveryUnknown, true, String(status));
    assert.strictEqual(receipt.errors[0].category, 'server-error', String(status));
  }
});

test('Telegram: an answer without the id of its message is of unknown delivery', async (t) => {
  // Before (V11): visulima made it a success with an empty id.
  for (const result of [{}, undefined, { message_id: 'x' }, []]) {
    t.mock.restoreAll();
    stubFetch(t, () => json({ ok: true, result }));
    const receipt = await transport().send(message());
    assert.strictEqual(receipt.successful, false);
    assert.strictEqual(receipt.deliveryUnknown, true);
  }
});

test('Telegram: a medium goes by the method of its type, a URL or an id as it is', async (t) => {
  const requests = stubFetch(t, () => ok());
  const cases = [
    [{ url: 'https://example.com/a.png', contentType: 'image/png' }, 'sendPhoto', 'photo'],
    [{ url: 'https://example.com/a.gif', contentType: 'image/gif' }, 'sendAnimation', 'animation'],
    [{ id: 'BAACAgIAAxkB', contentType: 'video/mp4' }, 'sendVideo', 'video'],
    [{ url: 'https://example.com/a.mp3', contentType: 'audio/mpeg' }, 'sendAudio', 'audio'],
    [
      { url: 'https://example.com/a.pdf', contentType: 'application/pdf' },
      'sendDocument',
      'document',
    ],
    [{ url: 'https://example.com/a' }, 'sendDocument', 'document'],
  ];
  for (const [medium, method, field] of cases) {
    await transport({ parseMode: 'HTML' }).send(
      message({ text: 'The <b>caption</b>', media: [medium] }),
    );
    const request = requests.at(-1);
    assert.ok(request.url.endsWith(`/${method}`), method);
    assert.deepStrictEqual(request.json, {
      chat_id: 987654321,
      [field]: medium.url ?? medium.id,
      caption: 'The <b>caption</b>',
      parse_mode: 'HTML',
    });
  }
});

test('Telegram: the bytes of a medium are a file of a form, an album of several', async (t) => {
  const requests = stubFetch(t, () => ok());
  await transport().send(
    message({
      text: undefined,
      media: [{ content: new Uint8Array([1, 2, 3]), contentType: 'image/png', filename: 'a.png' }],
      buttons: [{ type: 'url', text: 'Open', url: 'https://example.com/' }],
    }),
  );
  const form = requests[0].body;
  assert.ok(form instanceof FormData);
  assert.ok(requests[0].url.endsWith('/sendPhoto'));
  assert.strictEqual(form.get('chat_id'), '987654321');
  assert.deepStrictEqual(JSON.parse(form.get('reply_markup')), {
    inline_keyboard: [[{ text: 'Open', url: 'https://example.com/' }]],
  });
  const photo = form.get('photo');
  assert.strictEqual(photo.name, 'a.png');
  assert.strictEqual(photo.type, 'image/png');
  assert.deepStrictEqual(new Uint8Array(await photo.arrayBuffer()), new Uint8Array([1, 2, 3]));

  await transport().send(
    message({
      text: 'An album',
      media: [
        { content: new Uint8Array([1]), contentType: 'image/jpeg' },
        { url: 'https://example.com/b.mp4', contentType: 'video/mp4', caption: 'B' },
      ],
    }),
  );
  const album = requests[1].body;
  assert.ok(requests[1].url.endsWith('/sendMediaGroup'));
  assert.deepStrictEqual(JSON.parse(album.get('media')), [
    { type: 'photo', media: 'attach://file0', caption: 'An album' },
    { type: 'video', media: 'https://example.com/b.mp4', caption: 'B' },
  ]);
  assert.strictEqual(album.get('file0').type, 'image/jpeg');
  // An album is named by its first message.
  t.mock.restoreAll();
  stubFetch(t, () =>
    ok([
      { message_id: 3, chat: { id: 5 } },
      { message_id: 4, chat: { id: 5 } },
    ]),
  );
  const receipt = await transport().send(
    message({
      media: [
        { url: 'https://example.com/a.png', contentType: 'image/png' },
        { url: 'https://example.com/b.png', contentType: 'image/png' },
      ],
    }),
  );
  assert.strictEqual(receipt.messageId, '5:3');
});

test('Telegram: what Telegram would refuse fails before any request', async (t) => {
  const requests = stubFetch(t, () => ok());
  const photo = (extra = {}) => ({
    url: 'https://example.com/a.png',
    contentType: 'image/png',
    ...extra,
  });
  const cases = [
    [message({ text: 'x'.repeat(4097) }), 'validation', /4097 characters, more than 4096/],
    [message({ text: 'x'.repeat(1025), media: [photo()] }), 'validation', /more than 1024/],
    [message({ media: [photo({ caption: 'own' })] }), 'validation', /one or the other/],
    [message({ media: Array.from({ length: 11 }, () => photo()) }), 'validation', /ten|10 media/],
    [
      message({
        media: [photo(), photo()],
        buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }],
      }),
      'unsupported',
      /album takes no buttons/,
    ],
    [
      message({
        media: [photo(), { url: 'https://example.com/a.pdf', contentType: 'application/pdf' }],
      }),
      'unsupported',
      /photos and videos, or documents/,
    ],
    [
      message({ buttons: [{ type: 'call', text: 'Call', phone: '+380671234567' }] }),
      'unsupported',
      /call a phone/,
    ],
    [
      message({ buttons: [{ type: 'reply', text: 'x', id: 'y'.repeat(65) }] }),
      'validation',
      /64 bytes/,
    ],
    [message({ thread: 'general' }), 'validation', /topic of a forum/],
    [message({ payload: { chat_id: 1 } }), 'validation', /cannot set chat_id/],
    [message({ text: undefined, payload: { tag: 'x' } }), 'validation', /needs a text or media/],
  ];
  for (const [sent, category, pattern] of cases) {
    const receipt = await transport().send(sent);
    assert.strictEqual(receipt.successful, false, String(pattern));
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
    assert.strictEqual(receipt.channel, 'telegram');
  }
  // With markup, Telegram counts the text after its entities: it is sent.
  await transport({ parseMode: 'HTML' }).send(message({ text: `<b>${'x'.repeat(4096)}</b>` }));
  // A payload with its own text needs none of the message.
  await transport().send(message({ text: undefined, payload: { text: 'From the payload' } }));
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[1].json.text, 'From the payload');
});

test('Telegram: a token, a markup and a server are checked when the transport is made', () => {
  assert.throws(() => new TelegramTransport({}), /needs botToken/);
  assert.throws(() => new TelegramTransport({ botToken: 'abc/../x' }), /no token of a bot/);
  assert.throws(() => transport({ parseMode: 'Markdown' }), /'HTML' or 'MarkdownV2'/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), TypeError);
  assert.throws(() => transport({ concurrency: 0 }), RangeError);
  assert.strictEqual(transport({ baseUrl: 'http://localhost:8081' }).id, 'telegram');
  assert.ok(!JSON.stringify(transport()).includes(TOKEN));
});

test('Telegram: verify reads the bot, and a refused token fails it', async (t) => {
  const requests = stubFetch(t, () => ok({ id: 1, is_bot: true }));
  await transport().verify();
  assert.strictEqual(requests[0].url, `https://api.telegram.org/bot${TOKEN}/getMe`);
  assert.strictEqual(requests[0].method, 'GET');
  t.mock.restoreAll();
  stubFetch(t, () => refused(401, 'Unauthorized'));
  await assert.rejects(transport().verify(), (error) => error.statusCode === 401);
});

test('Telegram: sendMany sends each message, the receipts in their order', async (t) => {
  stubFetch(t, (request) => ok({ message_id: request.json.text.length, chat: { id: 1 } }));
  const receipts = [];
  for await (const receipt of transport().sendMany([
    message({ text: 'a' }),
    message({ text: 'bbb' }),
  ])) {
    receipts.push(receipt.messageId);
  }
  assert.deepStrictEqual(receipts, ['1:1', '1:3']);
});
