// Not ported: tests of ./meta against a stubbed fetch, the cases of
// thinwrap's spec of its WhatsApp connector (the body of a text, of a
// template and of an interactive message, `mapWhatsAppCode`) rewritten for
// this transport, and those of Messenger, Instagram, the blocks and bugs.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { MetaTransport } = require('../../src/meta/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const transport = (config = {}) =>
  new MetaTransport({
    accessToken: 'EAAG-system',
    whatsapp: { phoneNumberId: '1111' },
    messenger: { pageId: '2222', accessToken: 'EAAG-page' },
    instagram: { accountId: '3333' },
    retries: 0,
    ...config,
  });
const whatsapp = (fields = {}) =>
  createChannelMessage({
    channel: 'whatsapp',
    to: '+380671234567',
    text: 'Your code is 1234',
    ...fields,
  });
const messenger = (fields = {}) =>
  createChannelMessage({ channel: 'messenger', to: '7001', text: 'Hi', ...fields });
const instagram = (fields = {}) =>
  createChannelMessage({ channel: 'instagram', to: '8001', text: 'Hi', ...fields });
const wamid = (id = 'wamid.HBgM') => json({ messaging_product: 'whatsapp', messages: [{ id }] });
const sent = (id = 'm_1') => json({ recipient_id: '7001', message_id: id });
const graphError = (code, status = 400, subcode) =>
  json(
    {
      error: {
        message: `code ${code}`,
        type: 'OAuthException',
        code,
        ...(subcode && { error_subcode: subcode }),
      },
    },
    status,
  );

test('Meta: a text of WhatsApp is the Cloud API, its correlation id given back by webhooks', async (t) => {
  const requests = stubFetch(t, () => wamid());
  const receipt = await transport().send(whatsapp({ metadata: { correlationId: 'order-42' } }));
  assert.strictEqual(requests[0].url, 'https://graph.facebook.com/v23.0/1111/messages');
  assert.strictEqual(requests[0].headers.get('authorization'), 'Bearer EAAG-system');
  assert.deepStrictEqual(requests[0].json, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '380671234567',
    type: 'text',
    text: { body: 'Your code is 1234' },
    biz_opaque_callback_data: 'order-42',
  });
  // Meta tells of the delivery through its webhooks.
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: 'wamid.HBgM',
    provider: 'meta',
    channel: 'whatsapp',
    state: 'accepted',
  });
});

test('Meta: a template, a medium and the buttons of WhatsApp', async (t) => {
  const requests = stubFetch(t, () => wamid());
  const meta = transport({ graphVersion: 'v24.0' });
  await meta.send(
    whatsapp({
      text: undefined,
      template: { name: 'otp', language: 'uk', components: [{ type: 'body' }] },
    }),
  );
  assert.ok(requests[0].url.startsWith('https://graph.facebook.com/v24.0/'));
  assert.deepStrictEqual(requests[0].json.template, {
    name: 'otp',
    language: { code: 'uk' },
    components: [{ type: 'body' }],
  });
  await meta.send(
    whatsapp({
      text: 'The invoice',
      media: [
        { url: 'https://example.com/i.pdf', contentType: 'application/pdf', filename: 'i.pdf' },
      ],
    }),
  );
  assert.deepStrictEqual(requests[1].json.document, {
    link: 'https://example.com/i.pdf',
    caption: 'The invoice',
    filename: 'i.pdf',
  });
  await meta.send(whatsapp({ text: undefined, media: [{ id: '42', contentType: 'audio/ogg' }] }));
  assert.deepStrictEqual([requests[2].json.type, requests[2].json.audio], ['audio', { id: '42' }]);
  await meta.send(
    whatsapp({
      buttons: [
        { type: 'reply', text: 'Yes', id: 'yes' },
        { type: 'reply', text: 'No', id: 'no' },
      ],
    }),
  );
  assert.deepStrictEqual(requests[3].json.interactive, {
    type: 'button',
    body: { text: 'Your code is 1234' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: 'yes', title: 'Yes' } },
        { type: 'reply', reply: { id: 'no', title: 'No' } },
      ],
    },
  });
  await meta.send(
    whatsapp({ buttons: [{ type: 'url', text: 'Open', url: 'https://example.com/' }] }),
  );
  assert.deepStrictEqual(requests[4].json.interactive, {
    type: 'cta_url',
    body: { text: 'Your code is 1234' },
    action: { name: 'cta_url', parameters: { display_text: 'Open', url: 'https://example.com/' } },
  });
});

test('Meta: a message of Messenger is the Send API with the token of its page', async (t) => {
  const requests = stubFetch(t, () => sent());
  const receipt = await transport().send(messenger({ metadata: { correlationId: 'c-1' } }));
  assert.strictEqual(requests[0].url, 'https://graph.facebook.com/v23.0/2222/messages');
  assert.strictEqual(requests[0].headers.get('authorization'), 'Bearer EAAG-page');
  assert.deepStrictEqual(requests[0].json, {
    recipient: { id: '7001' },
    messaging_type: 'RESPONSE',
    message: { text: 'Hi', metadata: 'c-1' },
  });
  assert.strictEqual(receipt.messageId, 'm_1');
  assert.strictEqual(receipt.channel, 'messenger');
  await transport().send(
    messenger({
      buttons: [
        { type: 'url', text: 'Open', url: 'https://example.com/' },
        { type: 'reply', text: 'Later', id: 'later' },
      ],
      payload: { messaging_type: 'MESSAGE_TAG', tag: 'ACCOUNT_UPDATE' },
    }),
  );
  assert.deepStrictEqual(requests[1].json, {
    recipient: { id: '7001' },
    messaging_type: 'MESSAGE_TAG',
    tag: 'ACCOUNT_UPDATE',
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: 'Hi',
          buttons: [
            { type: 'web_url', url: 'https://example.com/', title: 'Open' },
            { type: 'postback', title: 'Later', payload: 'later' },
          ],
        },
      },
    },
  });
  await transport().send(
    messenger({
      text: undefined,
      media: [{ url: 'https://example.com/a.png', contentType: 'image/png' }],
    }),
  );
  assert.deepStrictEqual(requests[2].json.message, {
    attachment: { type: 'image', payload: { url: 'https://example.com/a.png' } },
  });
});

test('Meta: a message of Instagram takes the shared token, its buttons quick replies', async (t) => {
  const requests = stubFetch(t, () => sent('ig_1'));
  await transport().send(instagram({ buttons: [{ type: 'reply', text: 'Yes', id: 'yes' }] }));
  assert.strictEqual(requests[0].url, 'https://graph.facebook.com/v23.0/3333/messages');
  assert.strictEqual(requests[0].headers.get('authorization'), 'Bearer EAAG-system');
  assert.deepStrictEqual(requests[0].json.message, {
    text: 'Hi',
    quick_replies: [{ content_type: 'text', title: 'Yes', payload: 'yes' }],
  });
});

test('Meta: an error is told by its code and subcode, the categories of the channels', async (t) => {
  // Changed in the port: thinwrap made a recipient not on WhatsApp, a message
  // outside the window and a user who stopped marketing invalid.
  const cases = [
    [graphError(131026), 'not-on-channel', 'meta.131026', false],
    [graphError(131047), 'outside-window', 'meta.131047', false],
    [graphError(131050), 'opted-out', 'meta.131050', false],
    [graphError(131021), 'invalid-recipient', 'meta.131021', false],
    [graphError(131049), 'rejected', 'meta.131049', false],
    [graphError(551), 'blocked', 'meta.551', false],
    [graphError(10, 400, 2018278), 'outside-window', 'meta.10.2018278', false],
    [graphError(100, 400, 2018001), 'invalid-recipient', 'meta.100.2018001', false],
    [graphError(190, 401), 'auth', 'meta.190', false],
    [graphError(200, 403), 'configuration', 'meta.200', false],
    [graphError(10, 403), 'configuration', 'meta.10', false],
    [graphError(132001), 'validation', 'meta.132001', false],
    [graphError(100), 'validation', 'meta.100', false],
    [graphError(130429, 429), 'rate-limit', 'meta.130429', true],
    [graphError(131056), 'rate-limit', 'meta.131056', true],
    [graphError(131000, 500), 'service-unavailable', 'meta.131000', true],
    [new Response('oops', { status: 418 }), 'validation', 'meta.http_418', false],
  ];
  for (const [answer, category, code, retryable] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => answer.clone());
    const receipt = await transport().send(whatsapp());
    assert.strictEqual(receipt.errors[0].category, category, code);
    assert.strictEqual(receipt.errors[0].code, code, code);
    assert.strictEqual(receipt.retryable, retryable, code);
    assert.strictEqual(receipt.channel, 'whatsapp', code);
  }
});

test('Meta: an answer without the id of its message is of unknown delivery', async (t) => {
  stubFetch(t, () => json({ messaging_product: 'whatsapp', messages: [] }));
  assert.strictEqual((await transport().send(whatsapp())).deliveryUnknown, true);
});

test('Meta: what the APIs would refuse fails before any request', async (t) => {
  // Before (T10): thinwrap sent a type of template without its template.
  const requests = stubFetch(t, () => wamid());
  const replies = (n) =>
    Array.from({ length: n }, (_v, i) => ({ type: 'reply', text: `B${i}`, id: `b${i}` }));
  const cases = [
    [
      whatsapp({ text: undefined, payload: { type: 'template' } }),
      'validation',
      /type template needs its template/,
    ],
    [whatsapp({ text: 'x'.repeat(4097) }), 'validation', /more than 4096/],
    [whatsapp({ buttons: replies(4) }), 'validation', /3 reply buttons/],
    [
      whatsapp({ buttons: [{ type: 'reply', text: 'x'.repeat(21), id: 'x' }] }),
      'validation',
      /20 characters/,
    ],
    [
      whatsapp({
        buttons: [...replies(1), { type: 'url', text: 'x', url: 'https://example.com/' }],
      }),
      'unsupported',
      /three replies, or one link/,
    ],
    [
      whatsapp({ buttons: [{ type: 'call', text: 'x', phone: '+380671234567' }] }),
      'unsupported',
      /call a phone/,
    ],
    [
      whatsapp({ media: [{ content: new Uint8Array(1), contentType: 'image/png' }] }),
      'unsupported',
      /link or the id/,
    ],
    [
      whatsapp({
        media: [{ url: 'https://example.com/a.png' }, { url: 'https://example.com/b.png' }],
      }),
      'unsupported',
      /one medium/,
    ],
    [
      whatsapp({ media: [{ url: 'https://example.com/a.png', caption: 'own' }] }),
      'validation',
      /one or the other/,
    ],
    [
      whatsapp({ template: { name: 't', language: 'en' }, buttons: replies(1) }),
      'unsupported',
      /in its components/,
    ],
    [whatsapp({ payload: { to: '1' } }), 'validation', /cannot set to/],
    [messenger({ text: 'x'.repeat(2001) }), 'validation', /more than 2000/],
    [messenger({ buttons: replies(4) }), 'validation', /3 buttons/],
    [
      messenger({ media: [{ url: 'https://example.com/a.png' }] }),
      'unsupported',
      /a text or an attachment/,
    ],
    [messenger({ payload: { recipient: { id: '1' } } }), 'validation', /cannot set recipient/],
    [
      instagram({ buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }] }),
      'unsupported',
      /quick reply/,
    ],
    [
      instagram({ text: undefined, data: undefined, buttons: replies(1), payload: {} }),
      'validation',
      /needs a text/,
    ],
    [instagram({ buttons: replies(14) }), 'validation', /13 quick replies/],
    [
      messenger({
        text: undefined,
        media: [{ url: 'https://example.com/a.png' }, { url: 'https://example.com/b.png' }],
      }),
      'unsupported',
      /one attachment/,
    ],
    [
      messenger({
        text: undefined,
        media: [{ content: new Uint8Array(1), contentType: 'image/png' }],
      }),
      'unsupported',
      /URL or an id/,
    ],
    [
      messenger({ buttons: [{ type: 'reply', text: 'x'.repeat(21), id: 'x' }] }),
      'validation',
      /20 characters/,
    ],
    [
      messenger({ buttons: [{ type: 'call', text: 'x', phone: '+380671234567' }] }),
      'unsupported',
      /call a phone/,
    ],
    [messenger({ text: 'x'.repeat(641), buttons: replies(1) }), 'validation', /more than 640/],
    [
      messenger({ text: undefined, buttons: replies(1), payload: {} }),
      'validation',
      /needs a text/,
    ],
    [
      whatsapp({
        text: 'x'.repeat(1025),
        media: [{ url: 'https://example.com/a.png', contentType: 'image/png' }],
      }),
      'validation',
      /caption is more than 1024/,
    ],
    [
      whatsapp({ text: 'x'.repeat(1025), buttons: replies(1) }),
      'validation',
      /buttons is more than 1024/,
    ],
    [
      whatsapp({ text: undefined, buttons: replies(1), payload: {} }),
      'validation',
      /buttons needs a text/,
    ],
    [
      whatsapp({ text: undefined, payload: {} }),
      'validation',
      /needs a text, a medium or a template/,
    ],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport().send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.strictEqual(requests.length, 0);
});

test('Meta: a channel without its block is refused, and the blocks are checked when made', async (t) => {
  const requests = stubFetch(t, () => wamid());
  const onlyWhatsApp = transport({ messenger: undefined, instagram: undefined });
  const receipt = await onlyWhatsApp.send(messenger());
  assert.strictEqual(receipt.errors[0].category, 'unsupported');
  assert.match(receipt.errorMessages[0], /has no messenger/);
  assert.strictEqual(requests.length, 0);
  assert.throws(
    () => new MetaTransport({ accessToken: 't' }),
    /needs whatsapp, messenger or instagram/,
  );
  assert.throws(() => new MetaTransport({ whatsapp: { phoneNumberId: '1' } }), /accessToken/);
  assert.throws(
    () => new MetaTransport({ accessToken: 't', whatsapp: { phoneNumberId: '../x' } }),
    /numeric id/,
  );
  assert.throws(() => transport({ graphVersion: 'latest' }), /version of Graph/);
  assert.throws(() => transport({ baseUrl: 'http://graph.example.com' }), TypeError);
  const shown =
    JSON.stringify(transport()) + require('node:util').inspect(transport(), { depth: 6 });
  assert.ok(!shown.includes('EAAG-page') && !shown.includes('EAAG-system'));
});

test('Meta: verify reads the number, the page and the account, each with its token', async (t) => {
  const requests = stubFetch(t, () => json({ id: '1' }));
  await transport().verify();
  assert.deepStrictEqual(
    requests.map((request) => [request.url, request.headers.get('authorization')]),
    [
      ['https://graph.facebook.com/v23.0/1111', 'Bearer EAAG-system'],
      ['https://graph.facebook.com/v23.0/2222', 'Bearer EAAG-page'],
      ['https://graph.facebook.com/v23.0/3333', 'Bearer EAAG-system'],
    ],
  );
  t.mock.restoreAll();
  stubFetch(t, () => graphError(190, 401));
  await assert.rejects(transport().verify(), (error) => error.statusCode === 401);
});
