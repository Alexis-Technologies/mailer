// Not ported: tests of ./channels, the messages of the channels other than
// email: their builder and its checks, phone numbers, and the markup of the
// chats.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  checkChannelMessage,
  countSegments,
  createChannelMessage,
  escapeDiscordMarkdown,
  escapeSlackText,
  escapeTelegramHtml,
  isChannelMessage,
  isE164,
  neutralizeMentions,
  normalizePhone,
} = require('../../src/channels/index.js');
const { createMessage } = require('../../src/index.js');

const sms = (extra = {}) => ({ channel: 'sms', to: '+380671234567', text: 'Code 1234', ...extra });

test('Channels: a message of SMS is built with its number in E.164 and its defaults', () => {
  const message = createChannelMessage(
    { channel: 'sms', to: '067 123 45 67', text: 'Code 1234', from: 'Hirevel' },
    { defaultCountry: 'UA' },
  );
  assert.deepStrictEqual(message, {
    channel: 'sms',
    to: '+380671234567',
    from: 'Hirevel',
    text: 'Code 1234',
    tags: [],
    priority: 'normal',
  });
  assert.strictEqual(createChannelMessage(sms({ tags: 'otp' })).tags[0], 'otp');
  // A national number needs its country.
  assert.throws(() => createChannelMessage(sms({ to: '067 123 45 67' })), /E\.164/);
  assert.throws(() => createChannelMessage(sms({ to: '+380 67 x' })), /E\.164/);
  assert.throws(
    () => createChannelMessage(sms({ to: '0671234567' }), { defaultCountry: 'Ukraine' }),
    /defaultCountry/,
  );
});

test('Channels: email, an unknown channel and the fields of another channel are refused', () => {
  assert.throws(
    () => createChannelMessage({ channel: 'email', to: 'a@example.com' }),
    /createMessage/,
  );
  assert.throws(() => createChannelMessage({ ...sms(), channel: 'fax' }), /Unknown channel/);
  assert.throws(() => createChannelMessage(null), TypeError);
  assert.throws(
    () => createChannelMessage(sms({ template: { name: 'otp', language: 'uk' } })),
    /sms takes no template/,
  );
  assert.throws(() => createChannelMessage(sms({ thread: 't' })), /sms takes no thread/);
  assert.throws(() => createChannelMessage(sms({ subject: 'Hi' })), /sms takes no subject/);
  assert.throws(
    () => createChannelMessage({ channel: 'telegram', to: 1, text: 'x', title: 'Hi' }),
    /telegram takes no title/,
  );
  // An undefined field is no field.
  assert.strictEqual(createChannelMessage(sms({ template: undefined })).template, undefined);
  assert.throws(() => createChannelMessage(sms({ text: undefined })), /nothing to send/);
  assert.throws(() => createChannelMessage(sms({ text: 42 })), /text must be a string/);
});

test('Channels: each channel takes the recipients of its kind', () => {
  const telegram = (to) => createChannelMessage({ channel: 'telegram', to, text: 'x' }).to;
  assert.strictEqual(telegram(42), 42);
  assert.strictEqual(telegram('-1001234567890'), '-1001234567890');
  assert.strictEqual(telegram('@hirevel_news'), '@hirevel_news');
  for (const to of ['@ab', 1.5, 'chat', undefined]) {
    assert.throws(() => telegram(to), /telegram/, String(to));
  }
  for (const channel of ['messenger', 'instagram', 'viber']) {
    assert.strictEqual(
      createChannelMessage({ channel, to: '1234567890', text: 'x' }).to,
      '1234567890',
    );
    assert.throws(() => createChannelMessage({ channel, to: 'a b', text: 'x' }), /id/);
    assert.throws(() => createChannelMessage({ channel, text: 'x' }), /id/);
  }
  // A webhook names its channel itself.
  for (const channel of ['slack', 'discord', 'google-chat']) {
    assert.strictEqual('to' in createChannelMessage({ channel, text: 'x' }), false);
    assert.strictEqual(createChannelMessage({ channel, to: 'C123', text: 'x' }).to, 'C123');
    assert.throws(() => createChannelMessage({ channel, to: '#a b', text: 'x' }), TypeError);
  }
  const conversation = {
    serviceUrl: 'https://smba.trafficmanager.net/emea/',
    conversationId: '19:a@thread.tacv2',
  };
  assert.deepStrictEqual(
    createChannelMessage({ channel: 'teams', to: { ...conversation, extra: 1 }, text: 'x' }).to,
    conversation,
  );
  assert.throws(
    () =>
      createChannelMessage({
        channel: 'teams',
        to: { ...conversation, serviceUrl: 'http://smba.trafficmanager.net/' },
        text: 'x',
      }),
    /https/,
  );
  for (const to of ['+380671234567', '+380671234567'.slice(0, 6)]) {
    for (const channel of ['rcs', 'whatsapp']) {
      if (isE164(to)) assert.strictEqual(createChannelMessage({ channel, to, text: 'x' }).to, to);
      else assert.throws(() => createChannelMessage({ channel, to, text: 'x' }), /E\.164/);
    }
  }
});

test('Channels: a push goes to a token, a topic or a subscription of Web Push', () => {
  const push = (to) => createChannelMessage({ channel: 'push', to, title: 'Hi' }).to;
  assert.deepStrictEqual(push({ token: 'f1:abc' }), { token: 'f1:abc' });
  assert.deepStrictEqual(push({ topic: 'news' }), { topic: 'news' });
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'BNcRdreALRFX', auth: 'tBHItJI5sv-Q' },
  };
  assert.deepStrictEqual(push(subscription), subscription);
  assert.throws(() => push({ ...subscription, endpoint: 'http://push.example.com/1' }), /https/);
  assert.throws(() => push({ ...subscription, keys: { p256dh: 'a b', auth: 'x' } }), TypeError);
  assert.throws(() => push({ token: '' }), /token/);
  assert.throws(() => push({ topic: 'a/b' }), /topic/);
  assert.throws(() => push('token'), TypeError);
  assert.deepStrictEqual(
    createChannelMessage({ channel: 'push', to: { token: 't' }, data: { orderId: '42' } }).data,
    Object.assign(Object.create(null), { orderId: '42' }),
  );
  assert.throws(
    () => createChannelMessage({ channel: 'push', to: { token: 't' }, data: { n: 1 } }),
    /data/,
  );
});

test('Channels: media, buttons, mentions and a payload are checked and copied', () => {
  const media = [
    { url: 'https://example.com/a.png', contentType: 'image/png', caption: 'A' },
    { id: 'wamid.1' },
    { content: new Uint8Array([1]), contentType: 'application/pdf', filename: 'receipt.pdf' },
  ];
  const buttons = [
    { type: 'url', text: 'Open', url: 'https://example.com/o/1' },
    { type: 'reply', text: 'Yes', id: 'yes' },
    { type: 'call', text: 'Call', phone: '+380671234567' },
  ];
  const payload = { blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Hi*' } }] };
  const message = createChannelMessage({
    channel: 'slack',
    text: 'Hi',
    media,
    buttons,
    payload,
    mentions: { everyone: false, users: ['U1'] },
  });
  assert.deepStrictEqual(message.media, media);
  assert.deepStrictEqual(message.buttons, buttons);
  assert.deepStrictEqual(message.payload, payload);
  assert.deepStrictEqual(message.mentions, { everyone: false, users: ['U1'] });
  // A later change of the caller's objects changes nothing sent.
  payload.blocks.push({ type: 'divider' });
  media[0].url = 'https://evil.example/x';
  assert.strictEqual(message.payload.blocks.length, 1);
  assert.strictEqual(message.media[0].url, 'https://example.com/a.png');
  const refused = [
    { media: [{ url: 'https://a.example/1', id: 'x' }] },
    { media: [{ content: new Uint8Array([1]) }] },
    { media: [{ url: 'ftp://a.example/1' }] },
    { media: [{ id: 'x', contentType: 'text/plain\r\nX: y' }] },
    { media: [{ id: 'x', size: 1 }] },
    { media: { id: 'x' } },
    { buttons: [{ type: 'menu', text: 'x' }] },
    { buttons: [{ type: 'url', text: '', url: 'https://a.example' }] },
    { buttons: [{ type: 'url', text: 'Open', url: 'javascript:alert(1)' }] },
    { buttons: [{ type: 'call', text: 'Call', phone: '067' }] },
    { buttons: [{ type: 'reply', text: 'Yes', id: 'yes', url: 'https://a.example' }] },
    { payload: [1] },
    { payload: { at: new Date() } },
    { mentions: { everyone: 'yes' } },
    { mentions: { users: ['a b'] } },
    { mentions: { channels: [] } },
  ];
  for (const fields of refused) {
    assert.throws(
      () => createChannelMessage({ channel: 'slack', text: 'Hi', ...fields }),
      TypeError,
      JSON.stringify(fields),
    );
  }
});

test('Channels: a template of WhatsApp is the name, language and components of one', () => {
  const template = {
    name: 'otp_code',
    language: 'uk',
    components: [{ type: 'body', parameters: [] }],
  };
  const message = createChannelMessage({ channel: 'whatsapp', to: '+380671234567', template });
  assert.deepStrictEqual(message.template, template);
  for (const bad of [
    { name: 'otp' },
    { name: '', language: 'uk' },
    { name: 'otp', language: 'u' },
    { ...template, components: [1] },
    { ...template, kind: 'x' },
  ]) {
    assert.throws(
      () => createChannelMessage({ channel: 'whatsapp', to: '+380671234567', template: bad }),
      TypeError,
      JSON.stringify(bad),
    );
  }
});

test('Channels: the fields of every channel are checked as those of email', () => {
  const scheduledAt = new Date('2026-11-08T09:00:00Z');
  const message = createChannelMessage(
    sms({
      metadata: { correlationId: 'order-42' },
      tenantId: 'acme',
      idempotencyKey: 'otp:42',
      scheduledAt,
      expiresAt: new Date('2026-11-08T09:05:00Z'),
      priority: 'high',
    }),
  );
  assert.strictEqual(message.metadata.correlationId, 'order-42');
  assert.strictEqual(message.tenantId, 'acme');
  assert.notStrictEqual(message.scheduledAt, scheduledAt);
  assert.deepStrictEqual(message.scheduledAt, scheduledAt);
  for (const fields of [
    { metadata: { 'a b': '1' } },
    { tenantId: '' },
    { idempotencyKey: 'a\nb' },
    { scheduledAt: 'tomorrow' },
    { expiresAt: new Date('x') },
    { scheduledAt, expiresAt: new Date('2026-11-08T08:00:00Z') },
    { priority: 'urgent' },
    { tags: [''] },
    { from: '' },
  ]) {
    assert.throws(() => createChannelMessage(sms(fields)), TypeError, JSON.stringify(fields));
  }
});

test('Channels: a copy of a message is checked again, its number in E.164 already', () => {
  const message = createChannelMessage(sms());
  checkChannelMessage(message);
  checkChannelMessage({ ...message, text: 'Code 5678' });
  assert.throws(() => checkChannelMessage({ ...message, to: '067 123 45 67' }), /E\.164/);
  assert.throws(() => checkChannelMessage({ ...message, tags: undefined }), /tags/);
  assert.throws(() => checkChannelMessage({ ...message, priority: undefined }), /priority/);
  assert.throws(() => checkChannelMessage({ ...message, buttons: [{ type: 'x' }] }), TypeError);
  assert.ok(isChannelMessage(message));
  assert.ok(
    !isChannelMessage(
      createMessage({
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 's',
        content: { text: 't' },
      }),
    ),
  );
  assert.ok(!isChannelMessage({ channel: 'fax' }));
  assert.ok(!isChannelMessage(null));
});

test('Channels: a phone number in E.164 from the way people write one', () => {
  const cases = [
    ['+38 (067) 123-45-67', undefined, '+380671234567'],
    ['00380671234567', undefined, '+380671234567'],
    ['067 123 45 67', 'UA', '+380671234567'],
    ['+44 (0)20 7946 0018', undefined, '+442079460018'],
    ['020 7946 0018', 'GB', '+442079460018'],
    ['(415) 555-2671', 'US', '+14155552671'],
    ['1 415 555 2671', 'US', '+14155552671'],
    ['011 44 20 7946 0018', 'US', '+442079460018'],
    ['8 (912) 345-67-89', 'RU', '+79123456789'],
    ['8 029 123 45 67', 'BY', '+375291234567'],
    ['06 1 234 5678', 'HU', '+3612345678'],
    // Italy keeps the 0 of its numbers.
    ['06 1234 5678', 'IT', '+390612345678'],
    ['+800 1234 5678', undefined, '+80012345678'],
    ['067 123 45 67', undefined, undefined],
    ['+999 1234567', undefined, undefined],
    ['1-800-FLOWERS', 'US', undefined],
    ['+1234567890123456', undefined, undefined],
    ['', 'UA', undefined],
  ];
  for (const [input, defaultCountry, expected] of cases) {
    assert.strictEqual(normalizePhone(input, { defaultCountry }), expected, input);
  }
  assert.strictEqual(normalizePhone(380671234567), undefined);
  assert.throws(() => normalizePhone('067', { defaultCountry: 'XX' }), TypeError);
  assert.ok(isE164('+380671234567'));
  for (const value of ['380671234567', '+0671234567', '+3801', '+999123456', 42, null]) {
    assert.ok(!isE164(value), String(value));
  }
});

test('Channels: a Ukrainian text is UCS-2, its segments counted by code unit', () => {
  assert.deepStrictEqual(countSegments('Ваш код 1234'), {
    encoding: 'UCS-2',
    segments: 1,
    units: 12,
    characters: 12,
  });
  assert.strictEqual(countSegments('Код'.repeat(24)).segments, 2);
  assert.throws(() => countSegments(42), TypeError);
});

test('Channels: text goes into the markup of a chat as text, its mass mentions muted', () => {
  assert.strictEqual(
    escapeTelegramHtml('<b>"A" & B</b>'),
    '&lt;b&gt;&quot;A&quot; &amp; B&lt;/b&gt;',
  );
  assert.strictEqual(escapeTelegramHtml('plain'), 'plain');
  assert.strictEqual(escapeSlackText('<!channel> & <@U1>'), '&lt;!channel&gt; &amp; &lt;@U1&gt;');
  assert.strictEqual(
    escapeDiscordMarkdown('**a** _b_ [c](d) `e` \\'),
    '\\*\\*a\\*\\* \\_b\\_ \\[c\\]\\(d\\) \\`e\\` \\\\',
  );
  assert.strictEqual(escapeDiscordMarkdown('plain'), 'plain');
  assert.strictEqual(
    neutralizeMentions('@everyone @here <!channel> <!here|here> <!everyone> @heretic'),
    '@​everyone @​here &lt;!channel&gt; &lt;!here|here&gt; &lt;!everyone&gt; @heretic',
  );
});

test('Channels: the fingerprint of a message of a channel is what it says', () => {
  const { fingerprintOf } = require('../../src/internal/fingerprint.js');
  const base = {
    channel: 'slack',
    to: 'C123',
    text: 'Deployed',
    media: [{ url: 'https://example.com/a.png', caption: 'A' }],
    payload: { blocks: [{ type: 'section', text: 'x' }], b: 1 },
    tags: ['deploys'],
    priority: 'normal',
    metadata: { b: '2', a: '1' },
  };
  const print = fingerprintOf(createChannelMessage(base));
  assert.match(print, /^[0-9a-f]{64}$/);
  // The order of keys of a payload or of metadata makes no other message.
  assert.strictEqual(
    fingerprintOf(
      createChannelMessage({
        ...base,
        payload: { b: 1, blocks: [{ text: 'x', type: 'section' }] },
        metadata: { a: '1', b: '2' },
      }),
    ),
    print,
  );
  // Neither the key, which an attempt may set, nor the tenant or the end of validity.
  assert.strictEqual(
    fingerprintOf(
      createChannelMessage({
        ...base,
        idempotencyKey: 'k',
        tenantId: 'acme',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      }),
    ),
    print,
  );
  for (const change of [
    { to: 'C124' },
    { text: 'Deployed!' },
    { media: [{ url: 'https://example.com/b.png', caption: 'A' }] },
    { media: [{ url: 'https://example.com/a.png', caption: 'B' }] },
    { payload: { blocks: [] } },
    { buttons: [{ type: 'reply', text: 'OK', id: 'ok' }] },
    { mentions: { everyone: true } },
    { thread: '1.2' },
    { priority: 'high' },
    { tags: ['other'] },
    { scheduledAt: new Date('2030-01-01T00:00:00Z') },
    { metadata: { a: '1' } },
    { channel: 'discord' },
  ]) {
    assert.notStrictEqual(
      fingerprintOf(createChannelMessage({ ...base, ...change })),
      print,
      JSON.stringify(change),
    );
  }
  // The bytes of a medium are not read for it.
  let read = false;
  const content = () => {
    read = true;
    return new Uint8Array(0);
  };
  fingerprintOf(
    createChannelMessage({
      channel: 'push',
      to: { endpoint: 'https://push.example.com/1', keys: { p256dh: 'p', auth: 'a' } },
      title: 'Hi',
      data: { a: '1' },
      media: [{ content, contentType: 'image/png' }],
    }),
  );
  assert.strictEqual(read, false);
  // A message of a channel never meets an email one, whatever its fields.
  const email = createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 's',
    content: { text: 't' },
  });
  assert.notStrictEqual(fingerprintOf(email), fingerprintOf({ ...email, channel: 'sms' }));
});

test('Channels: retry and pool give every attempt of a message one client reference', async () => {
  const { pinMessageId } = require('../../src/core/message-id.js');
  const { RetryTransport } = require('../../src/retry/index.js');
  const { fakeTransport, failed, sent } = require('../helpers/decorators/fake.js');
  const message = createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Code 1234' });
  const pinned = pinMessageId(message, () => 'ref-1');
  assert.strictEqual(pinned.idempotencyKey, 'ref-1');
  assert.strictEqual(pinMessageId(message), pinned);
  assert.strictEqual(message.idempotencyKey, undefined);
  // A key of the caller's is the reference.
  const keyed = createChannelMessage({ ...message, idempotencyKey: 'otp:42' });
  assert.strictEqual(pinMessageId(keyed), keyed);
  // Before: each attempt of ./retry sent the message with no reference, so a
  // provider could not tell a send made again.
  const transport = fakeTransport((_message, index) =>
    index === 0 ? failed('server-error') : sent('SM1'),
  );
  const retry = new RetryTransport(transport, { maxAttempts: 2, initialDelay: 1, maxDelay: 1 });
  const receipt = await retry.send(message);
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(transport.calls.length, 2);
  assert.ok(typeof transport.calls[0].message.idempotencyKey === 'string');
  assert.strictEqual(
    transport.calls[0].message.idempotencyKey,
    transport.calls[1].message.idempotencyKey,
  );
});

test('Channels: the recipient of a message is redacted as it is written, unless it is short', () => {
  const {
    recipientOf,
    redactMessageRecipient,
  } = require('../../src/internal/channel/recipient.js');
  assert.strictEqual(recipientOf(undefined), undefined);
  assert.strictEqual(recipientOf(42), '42');
  assert.strictEqual(recipientOf({ topic: 'news' }), 'news');
  const push = { to: { endpoint: 'https://push.example/sub/abcdef' } };
  assert.strictEqual(
    redactMessageRecipient('410 at https://push.example/sub/abcdef for bob@example.com', push),
    '410 at [REDACTED] for [REDACTED]',
  );
  // A chat 42 would replace the 42 of any text.
  assert.strictEqual(redactMessageRecipient('chat 42 of 420', { to: 42 }), 'chat 42 of 420');
  assert.strictEqual(redactMessageRecipient('no message +380671234567'), 'no message [REDACTED]');
});
