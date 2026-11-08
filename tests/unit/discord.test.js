// Not ported: tests of ./discord against a stubbed fetch, the cases of
// thinwrap's spec of its Discord connector (`?wait=true` and `thread_id` of a
// webhook, the categories of its statuses, the wait of a 429 in its body)
// rewritten for this transport, and those of the REST API of a bot, its
// nonce, its mentions, buckets and bugs.
const { test } = require('node:test');
const assert = require('node:assert');
const { createHash } = require('node:crypto');
const { createChannelMessage } = require('../../src/channels/index.js');
const { DiscordTransport } = require('../../src/discord/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const TOKEN = 'MTA.discord-bot-token.xyz';
const WEBHOOK = 'https://discord.com/api/webhooks/123/webhook-token';
const transport = (config = {}) =>
  new DiscordTransport({ botToken: TOKEN, webhookUrl: WEBHOOK, retries: 0, ...config });
const message = (fields = {}) =>
  createChannelMessage({ channel: 'discord', to: '111', text: 'Deployed', ...fields });
const created = (id = '1100000000000000001', headers = {}) => json({ id }, 200, headers);
const nonce = (key) => createHash('sha256').update(key).digest('base64url').slice(0, 25);

test('Discord: a message with `to` is created by the bot, under the nonce of its key', async (t) => {
  const requests = stubFetch(t, () => created());
  const receipt = await transport().send(message({ idempotencyKey: 'deploy:1' }));
  assert.strictEqual(requests[0].url, 'https://discord.com/api/v10/channels/111/messages');
  assert.strictEqual(requests[0].headers.get('authorization'), `Bot ${TOKEN}`);
  assert.deepStrictEqual(requests[0].json, {
    content: 'Deployed',
    allowed_mentions: { parse: [] },
    nonce: nonce('deploy:1'),
    enforce_nonce: true,
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: '1100000000000000001',
    provider: 'discord',
    channel: 'discord',
    state: 'sent',
  });
  // A message of no key has a nonce of an id of its own.
  await transport({ generateId: () => 'own-id' }).send(message());
  assert.strictEqual(requests[1].json.nonce, nonce('own-id'));
  // A thread is the channel the bot posts into.
  await transport().send(message({ thread: '222' }));
  assert.strictEqual(requests[2].url, 'https://discord.com/api/v10/channels/222/messages');
});

test('Discord: a message without `to` goes to the webhook, waiting for the message', async (t) => {
  const requests = stubFetch(t, () => created('42'));
  const receipt = await transport().send(
    message({
      to: undefined,
      thread: '999',
      buttons: [{ type: 'url', text: 'Open', url: 'https://example.com/' }],
    }),
  );
  const url = new URL(requests[0].url);
  assert.strictEqual(`${url.origin}${url.pathname}`, WEBHOOK);
  assert.strictEqual(url.searchParams.get('wait'), 'true');
  assert.strictEqual(url.searchParams.get('thread_id'), '999');
  assert.strictEqual(url.searchParams.get('with_components'), 'true');
  assert.strictEqual(requests[0].headers.get('authorization'), null);
  // A webhook takes no nonce.
  assert.deepStrictEqual(requests[0].json, {
    content: 'Deployed',
    allowed_mentions: { parse: [] },
    components: [
      { type: 1, components: [{ type: 2, style: 5, label: 'Open', url: 'https://example.com/' }] },
    ],
  });
  assert.strictEqual(receipt.messageId, '42');
});

test('Discord: no mention notifies unless the message names it', async (t) => {
  // Before (T8, V10): thinwrap and visulima sent no allowed_mentions, and an
  // @everyone in a text of a user pinged the whole server.
  const requests = stubFetch(t, () => created());
  await transport().send(message({ text: 'Hey @everyone <@1> <@&2>' }));
  assert.deepStrictEqual(requests[0].json.allowed_mentions, { parse: [] });
  assert.strictEqual(requests[0].json.content, 'Hey @everyone <@1> <@&2>');
  await transport().send(
    message({
      text: 'Hey @everyone <@1>',
      mentions: { everyone: true, users: ['1'], roles: ['2'] },
    }),
  );
  assert.deepStrictEqual(requests[1].json.allowed_mentions, {
    parse: ['everyone'],
    users: ['1'],
    roles: ['2'],
  });
});

test('Discord: buttons in rows of five, pictures as embeds, bytes as files, low as silent', async (t) => {
  const requests = stubFetch(t, () => created());
  const buttons = [];
  for (let i = 0; i < 7; i++) buttons.push({ type: 'reply', text: `B${i}`, id: `b${i}` });
  await transport().send(
    message({
      priority: 'low',
      buttons,
      media: [{ url: 'https://example.com/a.png', contentType: 'image/png' }],
    }),
  );
  const body = requests[0].json;
  assert.strictEqual(body.flags, 4096);
  assert.deepStrictEqual(body.embeds, [{ image: { url: 'https://example.com/a.png' } }]);
  assert.strictEqual(body.components.length, 2);
  assert.strictEqual(body.components[0].components.length, 5);
  assert.deepStrictEqual(body.components[1].components[1], {
    type: 2,
    style: 1,
    label: 'B6',
    custom_id: 'b6',
  });
  await transport().send(
    message({
      media: [
        {
          content: new Uint8Array([1, 2]),
          contentType: 'image/png',
          filename: 'a.png',
          caption: 'A',
        },
      ],
    }),
  );
  const form = requests[1].body;
  assert.ok(form instanceof FormData);
  assert.deepStrictEqual(JSON.parse(form.get('payload_json')).attachments, [
    { id: 0, filename: 'a.png', description: 'A' },
  ]);
  assert.strictEqual(form.get('files[0]').type, 'image/png');
});

test('Discord: a refusal is told by its JSON code, then its status', async (t) => {
  const cases = [
    [404, 10003, 'invalid-recipient'],
    [404, 10015, 'auth'],
    [403, 50001, 'blocked'],
    [403, 50007, 'blocked'],
    [403, 50013, 'blocked'],
    [400, 50035, 'validation'],
    [400, 50006, 'validation'],
    [413, 40005, 'validation'],
    [401, 0, 'auth'],
    [403, 0, 'blocked'],
    [404, 0, 'invalid-recipient'],
  ];
  for (const [status, code, category] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => json({ code, message: 'refused' }, status));
    const receipt = await transport().send(message());
    assert.strictEqual(receipt.errors[0].category, category, `${status} ${code}`);
    assert.strictEqual(receipt.retryable, false, `${status} ${code}`);
    assert.strictEqual(
      receipt.errors[0].code,
      `discord.${code || `http_${status}`}`,
      `${status} ${code}`,
    );
  }
});

test('Discord: a 429 counts as an attempt and waits its retry_after', async (t) => {
  // Before (DC1): discord.js did not count a 429 among the attempts, so a
  // route that kept answering it was retried without end.
  const requests = stubFetch(t, () =>
    json({ message: 'You are being rate limited.', retry_after: 0.001, global: false }, 429),
  );
  const receipt = await transport({ retries: 1 }).send(message());
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(receipt.errors[0].category, 'rate-limit');
  assert.strictEqual(receipt.errors[0].retryAfterMilliseconds, 1);
  assert.strictEqual(receipt.retryable, true);
});

test('Discord: a bot sends a 5xx or a lost answer again under its nonce, a webhook does not', async (t) => {
  // Before (DC1): discord.js retried a timeout with no nonce; a bot's nonce
  // makes Discord return the message it created.
  const requests = stubFetch(t, (_request, index) =>
    index === 0 ? new Response('', { status: 502 }) : created(),
  );
  const receipt = await transport({ retries: 1 }).send(message({ idempotencyKey: 'k' }));
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].json.nonce, requests[1].json.nonce);
  t.mock.restoreAll();
  const hooked = stubFetch(t, () => new Response('', { status: 502 }));
  const unknown = await transport({ retries: 3 }).send(message({ to: undefined }));
  assert.strictEqual(hooked.length, 1);
  assert.strictEqual(unknown.deliveryUnknown, true);
});

test('Discord: a send waits for the bucket of its route, and tells a long wait', async (t) => {
  const requests = stubFetch(t, () =>
    created('1', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '0.05' }),
  );
  const discord = transport();
  await discord.send(message());
  const started = performance.now();
  await discord.send(message());
  assert.ok(performance.now() - started >= 40, 'the second send waited for the bucket');
  assert.strictEqual(requests.length, 2);
  t.mock.restoreAll();
  stubFetch(t, () =>
    created('1', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '60' }),
  );
  const slow = transport();
  await slow.send(message());
  const receipt = await slow.send(message());
  assert.strictEqual(receipt.errors[0].category, 'rate-limit');
  assert.ok(receipt.errors[0].retryAfterMilliseconds > 30_000);
  // Another route has its own bucket.
  const other = await slow.send(message({ to: '333' }));
  assert.strictEqual(other.successful, true);
});

test('Discord: an answer without the id of its message is of unknown delivery', async (t) => {
  stubFetch(t, () => json({}));
  const receipt = await transport().send(message());
  assert.strictEqual(receipt.deliveryUnknown, true);
});

test('Discord: what Discord would refuse fails before any request', async (t) => {
  const requests = stubFetch(t, () => created());
  const many = (n, make) => Array.from({ length: n }, (_v, i) => make(i));
  const cases = [
    [message({ text: 'x'.repeat(2001) }), 'validation', /more than 2000/],
    [
      message({ buttons: many(26, (i) => ({ type: 'reply', text: 'x', id: `b${i}` })) }),
      'validation',
      /25 buttons/,
    ],
    [
      message({ buttons: [{ type: 'url', text: 'x'.repeat(81), url: 'https://example.com/' }] }),
      'validation',
      /80 characters/,
    ],
    [
      message({ buttons: [{ type: 'reply', text: 'x', id: 'y'.repeat(101) }] }),
      'validation',
      /100 characters/,
    ],
    [
      message({ buttons: [{ type: 'call', text: 'x', phone: '+380671234567' }] }),
      'unsupported',
      /call a phone/,
    ],
    [
      message({ to: undefined, buttons: [{ type: 'reply', text: 'x', id: 'y' }] }),
      'unsupported',
      /no button that replies/,
    ],
    [
      message({
        media: many(11, () => ({ url: 'https://example.com/a.png', contentType: 'image/png' })),
      }),
      'validation',
      /10 embeds/,
    ],
    [
      message({
        media: many(11, () => ({ content: new Uint8Array(1), contentType: 'image/png' })),
      }),
      'validation',
      /10 files/,
    ],
    [message({ media: [{ id: 'x' }] }), 'unsupported', /its bytes, or a picture/],
    [
      message({ media: [{ url: 'https://example.com/a.png' }], payload: { embeds: [] } }),
      'validation',
      /embeds of the payload/,
    ],
    [
      message({
        buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }],
        payload: { components: [] },
      }),
      'validation',
      /components of the payload/,
    ],
    [message({ payload: { nonce: 'x' } }), 'validation', /cannot set nonce/],
    [message({ text: undefined, payload: { tts: true } }), 'validation', /needs a text/],
  ];
  for (const [sent, category, pattern] of cases) {
    const receipt = await transport().send(sent);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.match(
    (await transport({ botToken: undefined }).send(message())).errorMessages[0],
    /no botToken/,
  );
  assert.match(
    (await transport({ webhookUrl: undefined }).send(message({ to: undefined }))).errorMessages[0],
    /no webhookUrl/,
  );
  assert.strictEqual(requests.length, 0);
});

test('Discord: the credentials are checked when the transport is made, and verified by reads', async (t) => {
  assert.throws(() => new DiscordTransport({}), /needs botToken, webhookUrl or both/);
  assert.throws(() => new DiscordTransport({ botToken: 'a b' }), /holds a space/);
  assert.throws(
    () => new DiscordTransport({ webhookUrl: 'http://discord.com/api/webhooks/1/SECRET' }),
    (error) => !error.message.includes('SECRET'),
  );
  assert.ok(!JSON.stringify(transport()).includes('webhook-token'));
  const requests = stubFetch(t, () => json({ id: '1' }));
  await transport().verify();
  assert.deepStrictEqual(
    requests.map((request) => [request.method, request.url]),
    [
      ['GET', 'https://discord.com/api/v10/users/@me'],
      ['GET', WEBHOOK],
    ],
  );
  t.mock.restoreAll();
  stubFetch(t, () => json({ message: '401: Unauthorized', code: 0 }, 401));
  await assert.rejects(
    transport({ webhookUrl: undefined }).verify(),
    (error) => error.statusCode === 401,
  );
});
