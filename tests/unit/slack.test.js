// Not ported: tests of ./slack against a stubbed fetch, the cases of
// thinwrap's spec of its Slack connector (the body of a webhook, its answer
// in plain text, the categories of its statuses) rewritten for this
// transport, and those of chat.postMessage, its mentions, blocks and bugs.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { SlackTransport } = require('../../src/slack/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const TOKEN = 'xoxb-1111-2222-abcdef';
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/XXXXXXXX';
const transport = (config = {}) =>
  new SlackTransport({ botToken: TOKEN, webhookUrl: WEBHOOK, retries: 0, ...config });
const message = (fields = {}) =>
  createChannelMessage({ channel: 'slack', to: 'C0123', text: 'Deployed', ...fields });
const posted = (channel = 'C0123', ts = '1700000000.000100') => json({ ok: true, channel, ts });

test('Slack: a message with `to` is chat.postMessage, with the token of the bot', async (t) => {
  const requests = stubFetch(t, () => posted());
  const receipt = await transport().send(message({ thread: '1690000000.000200' }));
  assert.strictEqual(requests[0].url, 'https://slack.com/api/chat.postMessage');
  assert.strictEqual(requests[0].headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.strictEqual(requests[0].headers.get('content-type'), 'application/json; charset=utf-8');
  assert.strictEqual(requests[0].redirect, 'manual');
  assert.deepStrictEqual(requests[0].json, {
    channel: 'C0123',
    text: 'Deployed',
    thread_ts: '1690000000.000200',
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: 'C0123:1700000000.000100',
    provider: 'slack',
    channel: 'slack',
    state: 'sent',
  });
});

test('Slack: a message without `to` goes to the webhook, its URL the credential', async (t) => {
  const requests = stubFetch(t, () => new Response('ok'));
  const receipt = await transport({ generateId: () => 'w-1' }).send(
    message({ to: undefined, payload: { unfurl_links: false } }),
  );
  assert.strictEqual(requests[0].url, WEBHOOK);
  assert.strictEqual(requests[0].headers.get('authorization'), null);
  assert.deepStrictEqual(requests[0].json, { text: 'Deployed', unfurl_links: false });
  // A webhook names no message: the id is the transport's own.
  assert.strictEqual(receipt.messageId, 'webhook:w-1');
  assert.strictEqual(receipt.state, 'sent');
});

test('Slack: a refused webhook is told by its text and status', async (t) => {
  const cases = [
    [400, 'invalid_payload', 'validation'],
    [400, 'no_text', 'validation'],
    [403, 'action_prohibited', 'blocked'],
    [403, 'invalid_token', 'auth'],
    [404, 'channel_not_found', 'invalid-recipient'],
    [404, 'no_service', 'auth'],
    [410, 'channel_is_archived', 'invalid-recipient'],
    [403, 'something_new', 'auth'],
    [400, '', 'validation'],
  ];
  for (const [status, text, category] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => new Response(text, { status }));
    const receipt = await transport().send(message({ to: undefined }));
    assert.strictEqual(receipt.successful, false, text);
    assert.strictEqual(receipt.errors[0].category, category, text);
    assert.strictEqual(receipt.errors[0].code, `slack.${text || `http_${status}`}`, text);
    assert.strictEqual(receipt.retryable, false, text);
  }
});

test('Slack: an ok false of the Web API is told by its error, a fatal one of unknown delivery', async (t) => {
  const cases = [
    ['channel_not_found', 'invalid-recipient', false],
    ['not_in_channel', 'not-on-channel', false],
    ['is_archived', 'invalid-recipient', false],
    ['restricted_action', 'blocked', false],
    ['msg_too_long', 'validation', false],
    ['invalid_blocks', 'validation', false],
    ['invalid_auth', 'auth', false],
    ['token_revoked', 'auth', false],
    ['missing_scope', 'configuration', false],
    ['service_unavailable', 'service-unavailable', true],
    ['fatal_error', 'server-error', false],
    ['internal_error', 'server-error', false],
    ['new_error', 'validation', false],
  ];
  for (const [error, category, retryable] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => json({ ok: false, error }));
    const receipt = await transport().send(message());
    assert.strictEqual(receipt.errors[0].category, category, error);
    assert.strictEqual(receipt.errors[0].code, `slack.${error}`, error);
    assert.strictEqual(receipt.retryable, retryable, error);
    const unknown = error === 'fatal_error' || error === 'internal_error';
    assert.strictEqual(receipt.deliveryUnknown, unknown ? true : undefined, error);
    assert.deepStrictEqual(receipt.errors[0].providerDetails, { ok: false, error }, error);
  }
});

test('Slack: a network failure, a timeout or a 5xx is not posted again', async (t) => {
  // Before (SL1): @slack/web-api retried chat.postMessage after a network
  // failure, ten times in half an hour, posting it again each time Slack had
  // taken it.
  for (const answer of [
    () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
      });
    },
    () => new Response('', { status: 500 }),
    () => new Response('', { status: 503 }),
  ]) {
    t.mock.restoreAll();
    const requests = stubFetch(t, answer);
    const receipt = await transport({ retries: 3 }).send(message());
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(receipt.deliveryUnknown, true);
  }
});

test('Slack: a 429 waits its Retry-After, then posts again', async (t) => {
  const requests = stubFetch(t, (_request, index) =>
    index === 0 ? json({ ok: false, error: 'ratelimited' }, 429, { 'Retry-After': '0' }) : posted(),
  );
  const receipt = await transport({ retries: 1 }).send(message());
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(requests.length, 2);
});

test('Slack: an answer without its ts is of unknown delivery', async (t) => {
  stubFetch(t, () => json({ ok: true, channel: 'C0123' }));
  const receipt = await transport().send(message());
  assert.strictEqual(receipt.deliveryUnknown, true);
});

test('Slack: a mention of a whole channel, a user or a group is neutralized unless named', async (t) => {
  const requests = stubFetch(t, () => posted());
  const text = 'Hey <!channel> <!here|here> <@U111> <@U222|bob> <!subteam^S333> @everyone';
  await transport().send(message({ text }));
  assert.strictEqual(
    requests[0].json.text,
    'Hey &lt;!channel&gt; &lt;!here|here&gt; &lt;@U111&gt; &lt;@U222|bob&gt; &lt;!subteam^S333&gt; @​everyone',
  );
  await transport().send(
    message({ text, mentions: { everyone: true, users: ['U222'], roles: ['S333'] } }),
  );
  assert.strictEqual(
    requests[1].json.text,
    'Hey <!channel> <!here|here> &lt;@U111&gt; <@U222|bob> <!subteam^S333> @everyone',
  );
});

test('Slack: buttons and pictures are Block Kit after the text', async (t) => {
  const requests = stubFetch(t, () => posted());
  await transport().send(
    message({
      text: 'Release *1.2*',
      media: [{ url: 'https://example.com/chart.png', contentType: 'image/png', caption: 'Chart' }],
      buttons: [
        { type: 'url', text: 'Open', url: 'https://example.com/' },
        { type: 'reply', text: 'Approve', id: 'approve' },
      ],
    }),
  );
  assert.deepStrictEqual(requests[0].json.blocks, [
    { type: 'section', text: { type: 'mrkdwn', text: 'Release *1.2*' } },
    { type: 'image', image_url: 'https://example.com/chart.png', alt_text: 'Chart' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open', emoji: true },
          url: 'https://example.com/',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve', emoji: true },
          value: 'approve',
          action_id: 'approve:1',
        },
      ],
    },
  ]);
  // The text stays the fallback of a notification.
  assert.strictEqual(requests[0].json.text, 'Release *1.2*');
  // A payload of blocks goes as it is.
  await transport().send(message({ text: 'x', payload: { blocks: [{ type: 'divider' }] } }));
  assert.deepStrictEqual(requests[1].json.blocks, [{ type: 'divider' }]);
});

test('Slack: what Slack would refuse fails before any request', async (t) => {
  const requests = stubFetch(t, () => posted());
  const cases = [
    [message({ text: 'x'.repeat(40001) }), 'validation', /more than 40000/],
    [
      message({
        text: 'x'.repeat(3001),
        buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }],
      }),
      'validation',
      /more than 3000/,
    ],
    [
      message({ buttons: [{ type: 'url', text: 'x'.repeat(76), url: 'https://example.com/' }] }),
      'validation',
      /75 characters/,
    ],
    [
      message({ buttons: [{ type: 'call', text: 'Call', phone: '+380671234567' }] }),
      'unsupported',
      /call a phone/,
    ],
    [
      message({ media: [{ content: new Uint8Array([1]), contentType: 'image/png' }] }),
      'unsupported',
      /no file/,
    ],
    [
      message({ media: [{ url: 'https://example.com/a.pdf', contentType: 'application/pdf' }] }),
      'unsupported',
      /no file/,
    ],
    [
      message({
        buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }],
        payload: { blocks: [] },
      }),
      'validation',
      /blocks of the payload/,
    ],
    [message({ payload: { channel: 'C9' } }), 'validation', /cannot set channel/],
    [message({ text: undefined, payload: { unfurl_links: true } }), 'validation', /needs a text/],
  ];
  for (const [sent, category, pattern] of cases) {
    const receipt = await transport().send(sent);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  // A transport of one credential refuses what needs the other.
  const webhookOnly = await transport({ botToken: undefined }).send(message());
  assert.match(webhookOnly.errorMessages[0], /no botToken/);
  const botOnly = await transport({ webhookUrl: undefined }).send(message({ to: undefined }));
  assert.match(botOnly.errorMessages[0], /no webhookUrl/);
  assert.strictEqual(requests.length, 0);
});

test('Slack: the credentials are checked when the transport is made, the webhook never shown', () => {
  assert.throws(() => new SlackTransport({}), /needs botToken, webhookUrl or both/);
  assert.throws(() => new SlackTransport({ botToken: 'xoxb bad' }), /holds a space/);
  assert.throws(
    () => new SlackTransport({ webhookUrl: 'http://hooks.slack.com/services/T/B/SECRET' }),
    (error) => error instanceof TypeError && !error.message.includes('SECRET'),
  );
  assert.throws(
    () => new SlackTransport({ webhookUrl: 'not a url SECRET' }),
    (error) => error instanceof TypeError && !error.message.includes('SECRET'),
  );
  assert.ok(!JSON.stringify(transport()).includes('XXXXXXXX'));
  assert.ok(!JSON.stringify(transport()).includes('abcdef'));
});

test('Slack: verify calls auth.test, and a refused token in a 200 fails it', async (t) => {
  const requests = stubFetch(t, () => json({ ok: true, team: 'T' }));
  await transport().verify();
  assert.strictEqual(requests[0].url, 'https://slack.com/api/auth.test');
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].headers.get('authorization'), `Bearer ${TOKEN}`);
  t.mock.restoreAll();
  stubFetch(t, () => json({ ok: false, error: 'invalid_auth' }));
  await assert.rejects(transport().verify(), /invalid_auth/);
  // A webhook cannot be checked without posting to it.
  t.mock.restoreAll();
  const none = stubFetch(t, () => json({ ok: true }));
  await transport({ botToken: undefined }).verify();
  assert.strictEqual(none.length, 0);
});
