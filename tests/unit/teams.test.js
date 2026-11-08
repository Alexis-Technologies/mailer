// Not ported: tests of ./teams against a stubbed fetch, the cases of
// thinwrap's spec of its Teams connector (the envelope of the Adaptive Card,
// the 202 of Workflows, the 200 of a connector with its embedded error, an
// invalid webhook) rewritten for this transport, and those of its bot.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { TeamsTransport } = require('../../src/teams/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const WEBHOOK =
  'https://prod-00.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=TeamsWebhookSecret';
const CONNECTOR = 'https://contoso.webhook.office.com/webhookb2/ConnectorSecret';
const SERVICE = 'https://smba.trafficmanager.net/emea/';
const CONVERSATION = '19:abc@thread.tacv2';
const BOT = { appId: 'app-1', clientSecret: 'BotAppSecret' };
let ids = 0;
const transport = (config = {}) =>
  new TeamsTransport({
    webhookUrl: WEBHOOK,
    retries: 0,
    generateId: () => `id-${++ids}`,
    ...config,
  });
const teams = (fields = {}) =>
  createChannelMessage({ channel: 'teams', text: 'Deployed **v1.2.3**', ...fields });
const toBot = (fields = {}) =>
  teams({ to: { serviceUrl: SERVICE, conversationId: CONVERSATION }, ...fields });
// The answers of Teams, the token endpoint of Microsoft answered apart.
const stub = (t, answer) => {
  const posts = [];
  let tokens = 0;
  stubFetch(t, (request) => {
    if (request.url.startsWith('https://login.microsoftonline.com/')) {
      tokens++;
      return json({ token_type: 'Bearer', access_token: `bot-token-${tokens}`, expires_in: 3600 });
    }
    posts.push(request);
    return answer(request, posts.length - 1);
  });
  return { posts, tokens: () => tokens };
};
const accepted = () => new Response(null, { status: 202 });
const CARD = 'application/vnd.microsoft.card.adaptive';
const SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';

test('Teams: a message to the webhook is an Adaptive Card, a 202 accepted', async (t) => {
  // Before (V13): visulima sent a MessageCard of the Office 365 connectors.
  ids = 0;
  const { posts } = stub(t, () => accepted());
  const receipt = await transport().send(teams());
  assert.strictEqual(posts[0].url, WEBHOOK);
  assert.strictEqual(posts[0].headers.get('authorization'), null);
  assert.strictEqual(posts[0].redirect, 'manual');
  assert.deepStrictEqual(posts[0].json, {
    type: 'message',
    attachments: [
      {
        contentType: CARD,
        content: {
          type: 'AdaptiveCard',
          $schema: SCHEMA,
          version: '1.4',
          body: [{ type: 'TextBlock', text: 'Deployed **v1.2.3**', wrap: true }],
        },
      },
    ],
  });
  // Before (T9): thinwrap made a 202 sent, though the flow posts the card after.
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: 'webhook:id-1',
    provider: 'teams',
    channel: 'teams',
    state: 'accepted',
  });
});

test('Teams: a picture and buttons are an Image and actions of the card', async (t) => {
  const { posts } = stub(t, () => accepted());
  await transport().send(
    teams({
      media: [{ url: 'https://example.com/chart.png', caption: 'Errors per minute' }],
      buttons: [
        { type: 'url', text: 'Open', url: 'https://example.com/run/1' },
        { type: 'reply', text: 'Ack', id: 'ack-1' },
      ],
      payload: { summary: 'Deployed' },
    }),
  );
  assert.deepStrictEqual(posts[0].json.attachments[0].content.body, [
    { type: 'TextBlock', text: 'Deployed **v1.2.3**', wrap: true },
    { type: 'Image', url: 'https://example.com/chart.png', altText: 'Errors per minute' },
  ]);
  assert.deepStrictEqual(posts[0].json.attachments[0].content.actions, [
    { type: 'Action.OpenUrl', title: 'Open', url: 'https://example.com/run/1' },
    { type: 'Action.Submit', title: 'Ack', data: { id: 'ack-1' } },
  ]);
  assert.strictEqual(posts[0].json.summary, 'Deployed');
});

test('Teams: a connector answers 1, or its error in a 200', async (t) => {
  const cases = [
    ['1', true, undefined],
    [
      'Webhook message delivery failed with error: Microsoft Teams endpoint returned HTTP error 429 with ContextId tcid=0',
      false,
      'rate-limit',
    ],
    ['Microsoft Teams endpoint returned HTTP error 413', false, 'validation'],
    ['Something else', false, 'unknown'],
  ];
  for (const [text, successful, category] of cases) {
    t.mock.restoreAll();
    stub(t, () => new Response(text, { status: 200 }));
    const receipt = await transport({ webhookUrl: CONNECTOR }).send(teams());
    assert.strictEqual(receipt.successful, successful, text);
    if (successful) assert.strictEqual(receipt.state, 'sent');
    else assert.strictEqual(receipt.errors[0].category, category, text);
  }
  t.mock.restoreAll();
  stub(t, () => new Response('Something else', { status: 200 }));
  const unknown = await transport({ webhookUrl: CONNECTOR }).send(teams());
  assert.strictEqual(unknown.deliveryUnknown, true);
  t.mock.restoreAll();
  stub(t, () => new Response('{"ok":true}', { status: 200 }));
  assert.strictEqual(
    (await transport().send(teams())).successful,
    true,
    'a flow answers as it says',
  );
});

test('Teams: a refusal of the webhook by its status, an invalid URL auth', async (t) => {
  const cases = [
    [new Response('Invalid webhook URL', { status: 400 }), 'auth', false],
    [new Response('Bad payload', { status: 400 }), 'validation', false],
    [new Response('', { status: 404 }), 'auth', false],
    [new Response('', { status: 429, headers: { 'retry-after': '1' } }), 'rate-limit', true],
  ];
  for (const [response, category, retryable] of cases) {
    t.mock.restoreAll();
    stub(t, () => response.clone());
    const receipt = await transport().send(teams());
    assert.strictEqual(receipt.errors[0].category, category, category);
    assert.strictEqual(receipt.retryable, retryable, category);
  }
  t.mock.restoreAll();
  const { posts } = stub(t, () => new Response('', { status: 502 }));
  const receipt = await transport({ retries: 3 }).send(teams());
  assert.strictEqual(receipt.deliveryUnknown, true, 'a flow may have run');
  assert.strictEqual(posts.length, 1);
  assert.ok(!JSON.stringify(receipt).includes('TeamsWebhookSecret'));
});

test('Teams: a message to a conversation goes through the bot, with its token', async (t) => {
  const { posts, tokens } = stub(t, () => json({ id: '1:activity-1' }, 201));
  const bot = transport({ webhookUrl: undefined, bot: BOT });
  const receipt = await bot.send(toBot());
  const [post] = posts;
  assert.strictEqual(
    post.url,
    `${SERVICE}v3/conversations/${encodeURIComponent(CONVERSATION)}/activities`,
  );
  assert.strictEqual(post.headers.get('authorization'), 'Bearer bot-token-1');
  assert.deepStrictEqual(post.json, {
    type: 'message',
    text: 'Deployed **v1.2.3**',
    textFormat: 'markdown',
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: '1:activity-1',
    provider: 'teams',
    channel: 'teams',
    state: 'sent',
  });
  await bot.send(toBot({ buttons: [{ type: 'url', text: 'Open', url: 'https://example.com/' }] }));
  assert.strictEqual(posts[1].json.attachments[0].contentType, CARD);
  assert.strictEqual(tokens(), 1, 'the token is shared');
});

test('Teams: the token of the bot goes to the tenant, and is asked anew on a 401', async (t) => {
  const requests = stubFetch(t, (request, index) => {
    if (request.url.includes('login.microsoftonline.com')) {
      return json({ access_token: `token-${index}`, expires_in: 3600 });
    }
    return index === 1 ? json({ error: { code: 'Unauthorized' } }, 401) : json({ id: 'a' });
  });
  const bot = transport({ bot: { ...BOT, tenantId: 'contoso.onmicrosoft.com' } });
  await bot.send(toBot());
  await bot.send(toBot());
  assert.strictEqual(
    requests[0].url,
    'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token',
  );
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(requests[0].body)), {
    grant_type: 'client_credentials',
    client_id: 'app-1',
    client_secret: 'BotAppSecret',
    scope: 'https://api.botframework.com/.default',
  });
  assert.strictEqual(requests.length, 4, 'a new token after the 401');
  assert.strictEqual(requests[3].headers.get('authorization'), 'Bearer token-2');
  t.mock.restoreAll();
  stubFetch(t, () => json({ error: 'invalid_client', error_description: 'AADSTS7000215' }, 401));
  const refused = await transport({ bot: BOT }).send(toBot());
  assert.strictEqual(refused.errors[0].category, 'auth');
  assert.strictEqual(refused.deliveryUnknown, undefined, 'nothing was sent');
});

test('Teams: a bot of the clouds of the US government asks for their scope', async (t) => {
  // Before (C33): the scope was the public one whatever the tokenUrl, so a
  // bot of GCC High or DoD, whose service URLs are allowed, never got a token.
  const requests = stubFetch(t, (request) =>
    request.url.includes('login.microsoftonline')
      ? json({ access_token: 't', expires_in: 3600 })
      : json({ id: 'a' }),
  );
  await transport({
    bot: { ...BOT, tenantId: 'contoso.onmicrosoft.us' },
    tokenUrl: 'https://login.microsoftonline.us/contoso.onmicrosoft.us/oauth2/v2.0/token',
  }).send(
    teams({
      to: { serviceUrl: 'https://smba.infra.gov.teams.microsoft.us/gcch', conversationId: 'c-1' },
    }),
  );
  assert.strictEqual(
    new URLSearchParams(requests[0].body).get('scope'),
    'https://api.botframework.us/.default',
  );
  t.mock.restoreAll();
  const own = stubFetch(t, (request) =>
    request.url.includes('login.microsoftonline')
      ? json({ access_token: 't', expires_in: 3600 })
      : json({ id: 'a' }),
  );
  await transport({ bot: BOT, scope: 'api://custom/.default' }).send(toBot());
  assert.strictEqual(new URLSearchParams(own[0].body).get('scope'), 'api://custom/.default');
});

test('Teams: a refusal of the Connector API by its code, then its status', async (t) => {
  const cases = [
    [json({ error: { code: 'BotNotInConversationRoster', message: 'x' } }, 403), 'blocked'],
    [json({ error: { code: 'ConversationNotFound', message: 'x' } }, 404), 'invalid-recipient'],
    [json({ error: { code: 'BadArgument', message: 'x' } }, 400), 'validation'],
    [json({ error: { code: 'Forbidden', message: 'x' } }, 403), 'configuration'],
    [json({}, 429, { 'retry-after': '1' }), 'rate-limit'],
  ];
  for (const [response, category] of cases) {
    t.mock.restoreAll();
    stub(t, () => response.clone());
    const receipt = await transport({ bot: BOT }).send(toBot());
    assert.strictEqual(receipt.errors[0].category, category, category);
  }
  t.mock.restoreAll();
  stub(t, () => json({}, 201));
  assert.strictEqual((await transport({ bot: BOT }).send(toBot())).deliveryUnknown, true);
});

test('Teams: what a message of Teams cannot be fails before any request', async (t) => {
  const { posts } = stub(t, () => accepted());
  const cases = [
    [teams({ mentions: { everyone: true } }), 'unsupported', /entity of the payload/],
    [
      teams({ buttons: [{ type: 'call', text: 'Call', phone: '+380441234567' }] }),
      'unsupported',
      /opens a link/,
    ],
    [
      teams({ media: [{ url: 'https://example.com/a.mp4', contentType: 'video/mp4' }] }),
      'unsupported',
      /picture at its URL/,
    ],
    [teams({ text: 'x'.repeat(29_000) }), 'validation', /28672 bytes/],
    // Changed (C21): a transport that lacks what a message needs refuses it
    // as unsupported, which ./pool fails over from.
    [toBot(), 'unsupported', /has no bot/],
    [
      teams({ to: { serviceUrl: 'https://evil.example/', conversationId: CONVERSATION } }),
      'unsupported',
      /serviceUrl is none of Teams/,
    ],
    [createChannelMessage({ channel: 'slack', text: 'x' }), 'unsupported', /not of slack/],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport({
      bot: message.to?.serviceUrl === SERVICE ? undefined : BOT,
    }).send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  const noWebhook = await transport({ webhookUrl: undefined, bot: BOT }).send(teams());
  assert.match(noWebhook.errorMessages[0], /has no webhookUrl/);
  assert.strictEqual(posts.length, 0);
});

test('Teams: the options are checked when made, the secrets never shown', async (t) => {
  assert.throws(() => new TeamsTransport({}), /needs webhookUrl, bot or both/);
  assert.throws(() => transport({ webhookUrl: 'http://example.com/hook' }), TypeError);
  assert.throws(() => transport({ bot: { appId: 'a' } }), /needs bot.clientSecret/);
  assert.throws(() => transport({ bot: { ...BOT, tenantId: 'a/b' } }), /bot.tenantId/);
  assert.throws(() => transport({ serviceUrls: ['http://example.com/'] }), TypeError);
  const shown = JSON.stringify(transport({ bot: BOT }));
  assert.ok(!shown.includes('TeamsWebhookSecret') && !shown.includes('BotAppSecret'));
  // A service URL of the application's own, by origin.
  const { posts } = stub(t, () => json({ id: 'a' }));
  await transport({ bot: BOT, serviceUrls: ['https://bots.example.com'] }).send(
    teams({ to: { serviceUrl: 'https://bots.example.com/teams', conversationId: 'c-1' } }),
  );
  assert.strictEqual(
    posts[0].url,
    'https://bots.example.com/teams/v3/conversations/c-1/activities',
  );
});
