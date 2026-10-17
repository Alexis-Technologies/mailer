// Ported from upyo v0.7.0 (packages/maileroo/src/message-converter.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createMessage } = require('../../src/core/message.js');
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createMailerooConfig } = require('../../src/maileroo/config.js');
const { convertMessage } = require('../../src/maileroo/message-converter.js');

const baseConfig = createMailerooConfig({ apiKey: 'test-key' });

const createBaseMessage = (overrides = {}) => {
  return {
    sender: { address: 'sender@example.com' },
    recipients: [{ address: 'recipient@example.com' }],
    ccRecipients: [],
    bccRecipients: [],
    replyRecipients: [],
    subject: 'Test Subject',
    content: { text: 'Test content' },
    attachments: [],
    priority: 'normal',
    tags: [],
    headers: new Headers(),
    ...overrides,
  };
};

describe('convertMessage', { concurrency: false }, () => {
  it('converts a basic text message', async () => {
    const result = await convertMessage(createBaseMessage(), baseConfig);

    assert.deepEqual(result.from, { address: 'sender@example.com' });
    assert.deepEqual(result.to, { address: 'recipient@example.com' });
    assert.equal(result.subject, 'Test Subject');
    assert.equal(result.plain, 'Test content');
    assert.equal(result.html, undefined);
  });

  it('converts addresses with display names', async () => {
    const result = await convertMessage(
      createBaseMessage({
        sender: { address: 'sender@example.com', name: 'Sender Name' },
        recipients: [
          {
            address: 'recipient@example.com',
            name: 'Recipient "Name"',
          },
        ],
      }),
      baseConfig,
    );

    assert.deepEqual(result.from, {
      address: 'sender@example.com',
      display_name: 'Sender Name',
    });
    assert.deepEqual(result.to, {
      address: 'recipient@example.com',
      display_name: 'Recipient "Name"',
    });
  });

  it('uses arrays for multiple recipients', async () => {
    const result = await convertMessage(
      createBaseMessage({
        recipients: [{ address: 'one@example.com' }, { address: 'two@example.com', name: 'Two' }],
      }),
      baseConfig,
    );

    assert.deepEqual(result.to, [
      { address: 'one@example.com' },
      { address: 'two@example.com', display_name: 'Two' },
    ]);
  });

  it('converts HTML content with text alternative', async () => {
    const result = await convertMessage(
      createBaseMessage({
        content: { html: '<h1>Hello</h1>', text: 'Hello' },
      }),
      baseConfig,
    );

    assert.equal(result.html, '<h1>Hello</h1>');
    assert.equal(result.plain, 'Hello');
  });

  it('handles CC, BCC, and reply-to recipients', async () => {
    const result = await convertMessage(
      createBaseMessage({
        ccRecipients: [{ address: 'cc@example.com' }],
        bccRecipients: [{ address: 'bcc1@example.com' }, { address: 'bcc2@example.com' }],
        replyRecipients: [{ address: 'reply@example.com' }],
      }),
      baseConfig,
    );

    assert.deepEqual(result.cc, { address: 'cc@example.com' });
    assert.deepEqual(result.bcc, [
      { address: 'bcc1@example.com' },
      { address: 'bcc2@example.com' },
    ]);
    assert.deepEqual(result.reply_to, { address: 'reply@example.com' });
  });

  it('applies Maileroo defaults from config', async () => {
    const config = createMailerooConfig({
      apiKey: 'test-key',
      tracking: false,
      tags: {
        campaign: 'welcome-2026',
        environment: 'test',
      },
    });

    const result = await convertMessage(createBaseMessage(), config);

    assert.ok(!result.tracking);
    assert.deepEqual(result.tags, {
      campaign: 'welcome-2026',
      environment: 'test',
    });
  });

  it('adds message tags as generated Maileroo tag keys', async () => {
    const config = createMailerooConfig({
      apiKey: 'test-key',
      tags: { campaign: 'default' },
    });

    const result = await convertMessage(createBaseMessage({ tags: ['one', 'two'] }), config);

    assert.deepEqual(result.tags, {
      campaign: 'default',
      tag1: 'one',
      tag2: 'two',
    });
  });

  it('uses idempotency keys as stable Maileroo references', async () => {
    const first = await convertMessage(
      createBaseMessage({ idempotencyKey: 'welcome-message-1' }),
      baseConfig,
    );
    const second = await convertMessage(
      createBaseMessage({ idempotencyKey: 'welcome-message-1' }),
      baseConfig,
    );

    assert.match(first.reference_id ?? '', /^[0-9a-f]{24}$/);
    assert.equal(first.reference_id, second.reference_id);
  });

  it('generates Maileroo references when idempotency keys are missing', async () => {
    const result = await convertMessage(createBaseMessage(), baseConfig);

    assert.match(result.reference_id ?? '', /^[0-9a-f]{24}$/);
  });

  it('converts priority and custom headers', async () => {
    const headers = new Headers();
    headers.set('X-Custom-Header', 'custom-value');
    headers.set('Subject', 'ignored');

    const result = await convertMessage(
      createBaseMessage({
        priority: 'high',
        headers,
      }),
      baseConfig,
    );

    assert.deepEqual(result.headers, {
      'X-Priority': '1',
      'x-custom-header': 'custom-value',
    });
  });

  it('converts attachments to base64 with inline content IDs', async () => {
    const result = await convertMessage(
      createBaseMessage({
        attachments: [
          {
            filename: 'hello.txt',
            content: new TextEncoder().encode('hello'),
            contentType: 'text/plain',
            inline: false,
            contentId: '',
          },
          {
            filename: 'logo.png',
            content: new Uint8Array([1, 2, 3]),
            contentType: 'image/png',
            inline: true,
            contentId: 'logo',
          },
        ],
      }),
      baseConfig,
    );

    assert.deepEqual(result.attachments, [
      {
        file_name: 'hello.txt',
        content_type: 'text/plain',
        content: 'aGVsbG8=',
        inline: undefined,
      },
      {
        file_name: 'logo',
        content_type: 'image/png',
        content: 'AQID',
        inline: true,
      },
    ]);
  });

  it('uses the filename for inline attachments without content IDs', async () => {
    const result = await convertMessage(
      createBaseMessage({
        attachments: [
          {
            filename: 'logo.png',
            content: new Uint8Array([1, 2, 3]),
            contentType: 'image/png',
            inline: true,
            contentId: '',
          },
        ],
      }),
      baseConfig,
    );

    assert.equal(result.attachments?.[0]?.file_name, 'logo.png');
  });

  it('propagates aborts while converting attachments', async () => {
    const controller = new AbortController();
    const reason = new Error('Stop converting Maileroo message.');
    const content = new Promise(() => {});
    const conversion = convertMessage(
      createBaseMessage({
        attachments: [
          {
            filename: 'slow.txt',
            content,
            contentType: 'text/plain',
            inline: false,
            contentId: '',
          },
        ],
      }),
      baseConfig,
      controller.signal,
    );

    controller.abort(reason);

    await assert.rejects(
      Promise.race([
        conversion,
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('Conversion did not abort.')), 50);
        }),
      ]),
      (error) => error === reason,
    );
  });

  it('does not attach abort listeners for immediate attachment content', async () => {
    const controller = new AbortController();
    const addEventListener = controller.signal.addEventListener.bind(controller.signal);
    let abortListeners = 0;

    Object.defineProperty(controller.signal, 'addEventListener', {
      configurable: true,
      value: (type, listener, options) => {
        if (type === 'abort') abortListeners++;
        addEventListener(type, listener, options);
      },
    });

    const result = await convertMessage(
      createBaseMessage({
        attachments: [
          {
            filename: 'immediate.txt',
            content: new TextEncoder().encode('hello'),
            contentType: 'text/plain',
            inline: false,
            contentId: '',
          },
        ],
      }),
      baseConfig,
      controller.signal,
    );

    assert.equal(result.attachments?.[0]?.content, 'aGVsbG8=');
    assert.equal(abortListeners, 0);
  });

  // Left out: upstream's tests of base64 without Buffer or with Uint8Array#toBase64,
  // fallbacks for other runtimes; on Node, Buffer is always there (CLAUDE.md, Platform).
});

const threadingConfig = createMailerooConfig({ apiKey: 'test-key' });

const headerOf = (headers, name) =>
  Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value);

describe('convertMessage() reply threading', () => {
  const base = {
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Re: Your request',
    content: { text: 'Thanks for getting in touch.' },
  };

  it('writes the typed threading fields', async () => {
    const message = createMessage({
      ...base,
      inReplyTo: '122@example.com',
      references: ['120@example.com', '121@example.com'],
    });
    const result = (await convertMessage(message, threadingConfig)).headers ?? {};

    assert.deepEqual(headerOf(result, 'In-Reply-To'), ['<122@example.com>']);
    assert.deepEqual(headerOf(result, 'References'), ['<120@example.com> <121@example.com>']);
  });

  it('prefers a typed field over a custom header', async () => {
    const message = createMessage({
      ...base,
      inReplyTo: ['typed@example.com'],
      headers: { 'In-Reply-To': '<custom@example.com>' },
    });
    const result = (await convertMessage(message, threadingConfig)).headers ?? {};

    assert.deepEqual(headerOf(result, 'In-Reply-To'), ['<typed@example.com>']);
  });

  it('lets an empty list suppress a custom header', async () => {
    const message = createMessage({
      ...base,
      inReplyTo: [],
      references: [],
      headers: {
        'In-Reply-To': '<custom@example.com>',
        References: '<custom@example.com>',
      },
    });
    const result = (await convertMessage(message, threadingConfig)).headers ?? {};

    assert.deepEqual(headerOf(result, 'In-Reply-To'), []);
    assert.deepEqual(headerOf(result, 'References'), []);
  });

  it('lets a custom header through when the field is unset', async () => {
    const message = createMessage({
      ...base,
      headers: { 'In-Reply-To': '<custom@example.com>' },
    });
    const result = (await convertMessage(message, threadingConfig)).headers ?? {};

    assert.deepEqual(headerOf(result, 'In-Reply-To'), ['<custom@example.com>']);
  });
});

const CALENDAR_ICS =
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:1@example.com',
    'SUMMARY:Lunch',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';

/** The invitation content as the providers below carry it: Base64. */
const CALENDAR_BASE64 = btoa(CALENDAR_ICS);

const AGENDA_ATTACHMENT = {
  inline: false,
  filename: 'agenda.txt',
  content: new TextEncoder().encode('agenda'),
  contentType: 'text/plain',
  contentId: '',
};

describe('convertMessage() calendar', () => {
  const invitation = (overrides = {}) =>
    createBaseMessage({
      calendar: { method: 'REQUEST', content: CALENDAR_ICS },
      ...overrides,
    });

  it('should carry the calendar as an invite.ics attachment', async () => {
    const result = await convertMessage(invitation(), baseConfig);

    assert.equal(result.attachments?.length, 1);
    assert.equal(result.attachments?.[0].file_name, 'invite.ics');
    assert.equal(
      result.attachments?.[0].content_type,
      'text/calendar; charset=utf-8; method=REQUEST',
    );
    assert.equal(result.attachments?.[0].content, CALENDAR_BASE64);
    // Maileroo overloads the filename for an inline part, which this is not.
    assert.equal(result.attachments?.[0].inline, undefined);
  });

  it('should place the invitation ahead of the other attachments', async () => {
    const result = await convertMessage(
      invitation({ attachments: [AGENDA_ATTACHMENT] }),
      baseConfig,
    );

    assert.deepEqual(
      result.attachments?.map((attachment) => attachment.file_name),
      ['invite.ics', 'agenda.txt'],
    );
  });

  it('should reject calendar content that never passed createMessage()', async () => {
    await assert.rejects(
      () =>
        convertMessage(
          createBaseMessage({
            calendar: { method: 'REQUEST', content: 'not a calendar' },
          }),
          baseConfig,
        ),
      { name: 'TypeError' },
    );
  });
});
