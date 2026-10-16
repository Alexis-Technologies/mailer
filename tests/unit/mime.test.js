// Paths of the ported MIME builder (src/mime/) that upstream's mime suites
// leave out (upstream reaches them through the SMTP suites). Each message is
// read back with postal-mime, an independent parser, not only matched against
// this library's own output.
const { test } = require('node:test');
const assert = require('node:assert');
const PostalMime = require('postal-mime');
const { createMessage, readAttachmentContent } = require('../../index.js');
const { composeMessage } = require('../../src/mime/index.js');

const base = { from: 'alex@example.com', to: 'bob@example.com', content: { text: 'Hi' } };

const wire = async (message, options) => {
  const composed = await composeMessage(message, options);
  return new TextDecoder().decode(await readAttachmentContent(composed.content));
};
const headerBlock = (text) => text.slice(0, text.indexOf('\r\n\r\n'));

test('MIME: non-ASCII names, subjects and filenames round-trip through encoded words', async () => {
  const subject =
    'Дуже довга тема листа, яка точно не вміститься в одне закодоване слово і має бути ' +
    'розбита на кілька';
  const filename = 'звіт за жовтень дві тисячі двадцять шостого року.pdf';
  const message = createMessage({
    from: { name: 'Алекс Долід', address: 'alex@example.com' },
    to: 'bob@example.com',
    cc: 'carol@example.com',
    subject,
    content: {},
    attachments: [
      {
        inline: false,
        filename,
        content: new Uint8Array([1, 2, 3]),
        contentType: 'application/pdf',
        contentId: '',
      },
    ],
  });
  const text = await wire(message);
  // RFC 2047 §2: a line with an encoded word holds 76 characters at most; the
  // first word, next to the field name, is split to fit.
  const header = headerBlock(text);
  assert.match(header, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(header, /^From: =\?UTF-8\?B\?/m);
  for (const line of header.split('\r\n')) {
    if (line.includes('=?')) assert.ok(line.length <= 76, `${line.length}: ${line}`);
  }
  const parsed = await PostalMime.parse(text);
  assert.strictEqual(parsed.subject, subject);
  assert.deepStrictEqual(parsed.from, { address: 'alex@example.com', name: 'Алекс Долід' });
  assert.deepStrictEqual(
    parsed.cc.map(({ address }) => address),
    ['carol@example.com'],
  );
  assert.deepStrictEqual(
    parsed.attachments.map((attachment) => attachment.filename),
    [filename],
  );
});

test('MIME: a display name with "<", "," or "@" stays a single mailbox', async () => {
  const name = 'Support <attacker@evil.com>, Real';
  const tricky = 'x\\", eve@evil.example, "';
  const text = await wire(
    createMessage({
      ...base,
      subject: 'a',
      to: { name: tricky, address: 'bob@example.com' },
      replyTo: { name, address: 'help@example.com' },
    }),
  );
  assert.match(
    headerBlock(text),
    /^Reply-To: "Support <attacker@evil.com>, Real" <help@example.com>$/m,
  );
  const parsed = await PostalMime.parse(text);
  assert.deepStrictEqual(parsed.replyTo, [{ address: 'help@example.com', name }]);
  assert.deepStrictEqual(parsed.to, [{ address: 'bob@example.com', name: tricky }]);
});

test('MIME: a hand-built message cannot inject part headers through an attachment', async () => {
  const attachment = {
    inline: true,
    filename: 'a.txt',
    content: new Uint8Array([0x61]),
    contentType: 'text/plain',
    contentId: 'a@example.com',
  };
  const built = createMessage({ ...base, subject: 'a', attachments: [attachment] });
  const injected = [
    { ...attachment, contentType: 'text/plain\r\nX-Injected: 1' },
    { ...attachment, contentId: 'a@example.com>\r\nX-Injected: 1\r\nX: <b' },
  ];
  for (const bad of injected) {
    await assert.rejects(composeMessage({ ...built, attachments: [bad] }), TypeError);
  }
  const withParameter = { ...attachment, contentType: 'text/plain; charset=utf-8' };
  const text = await wire({ ...built, attachments: [withParameter] });
  assert.match(text, /^Content-Type: text\/plain; charset=utf-8; name="a.txt"$/m);
});

test('MIME: a message without content gets an empty text part', async () => {
  const parsed = await PostalMime.parse(
    await wire(createMessage({ ...base, subject: 'Empty', content: {} })),
  );
  assert.strictEqual(parsed.subject, 'Empty');
  assert.strictEqual(parsed.text.trim(), '');
});

test('MIME: priority maps to X-Priority and X-MSMail-Priority', async () => {
  const low = headerBlock(await wire(createMessage({ ...base, subject: 'a', priority: 'low' })));
  assert.match(low, /^X-Priority: 5$/m);
  assert.match(low, /^X-MSMail-Priority: Low$/m);
  const high = headerBlock(await wire(createMessage({ ...base, subject: 'a', priority: 'high' })));
  assert.match(high, /^X-Priority: 1$/m);
  assert.match(high, /^X-MSMail-Priority: High$/m);
});

test('MIME: long headers fold at whitespace and unfold to the original', async () => {
  const subject = 'word '.repeat(60).trim();
  const text = await wire(createMessage({ ...base, subject }));
  const lines = headerBlock(text).split('\r\n');
  assert.ok(lines.every((line) => line.length <= 78));
  assert.ok(lines.filter((line) => line.startsWith(' word')).length >= 3);
  assert.strictEqual((await PostalMime.parse(text)).subject, subject);
});

test('MIME: a token too long to fold is refused', async () => {
  const message = createMessage({ ...base, subject: 'a', headers: { 'X-Long': 'y'.repeat(1200) } });
  await assert.rejects(wire(message), {
    name: 'RangeError',
    message: 'Header field x-long contains a token too long to fold.',
  });
});

test('MIME: the Message-ID comes from the message, then from a custom header', async () => {
  const own = await wire(createMessage({ ...base, subject: 'a', messageId: '<own@example.com>' }));
  assert.match(headerBlock(own), /^Message-ID: <own@example.com>$/m);
  const custom = await wire(
    createMessage({ ...base, subject: 'a', headers: { 'Message-ID': '<custom@example.com>' } }),
  );
  assert.match(headerBlock(custom), /^Message-ID: <custom@example.com>$/m);
});

test('MIME: a CR or LF in the subject cannot forge a header field', async () => {
  const text = await wire(createMessage({ ...base, subject: 'Hello\r\nBcc: eve@example.com' }));
  assert.doesNotMatch(headerBlock(text), /^Bcc:/m);
  assert.strictEqual((await PostalMime.parse(text)).bcc, undefined);
});

test('MIME: a large attachment is encoded in full', async () => {
  const content = new Uint8Array(1.5 * 1024 * 1024).fill(0x61);
  const message = createMessage({
    ...base,
    subject: 'Large',
    attachments: [
      {
        inline: false,
        filename: 'a.bin',
        content,
        contentType: 'application/octet-stream',
        contentId: '',
      },
    ],
  });
  const parsed = await PostalMime.parse(await wire(message));
  assert.strictEqual(parsed.attachments[0].content.byteLength, content.length);
});

test('MIME: a DKIM failure throws, or sends unsigned when asked to', async (t) => {
  const message = createMessage({ ...base, subject: 'Signed' });
  const signatures = [{ signingDomain: 'example.com', selector: 's', privateKey: 'not a key' }];
  await assert.rejects(wire(message, { dkim: { signatures } }), /Failed to import private key/);

  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const text = await wire(message, { dkim: { signatures, onSigningFailure: 'send-unsigned' } });
  assert.doesNotMatch(headerBlock(text), /^DKIM-Signature:/m);
  // Without a logger, the one warning a transport writes goes to console.warn.
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0][0], /^MAILER_DKIM_UNSIGNED: DKIM signing failed/);

  // With one, the warning goes to it, with the error and no console output.
  const records = [];
  const logger = { warn: (properties, line) => records.push([properties, line]) };
  await wire(message, { dkim: { signatures, onSigningFailure: 'send-unsigned' }, logger });
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0][0].code, 'MAILER_DKIM_UNSIGNED');
  assert.strictEqual(records[0][0].component, 'dkim');
  assert.match(records[0][0].error, /Failed to import private key/);

  await assert.rejects(composeMessage(message, { dkim: { signatures, bodyMode: 'eager' } }), {
    name: 'TypeError',
    message: 'Expected DKIM bodyMode to be buffered or streaming.',
  });
});

test('MIME: a boundary is random, not derived from the clock and Math.random', async (t) => {
  t.mock.method(Math, 'random', () => 0.5);
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const boundaries = new Set();
  for (let i = 0; i < 2; i++) {
    const text = await wire(
      createMessage({ ...base, subject: 'Hi', content: { text: 'Hi', html: '<p>Hi</p>' } }),
    );
    const boundary = /boundary="([^"]+)"/.exec(text)[1];
    assert.match(
      boundary,
      /^boundary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    boundaries.add(boundary);
  }
  assert.strictEqual(boundaries.size, 2);
});

test('MIME: generateId makes the left half of a generated Message-ID', async () => {
  const text = await wire(createMessage({ ...base, subject: 'Hi' }), {
    generateId: (kind) => `01JMIME.${kind}`,
  });
  assert.match(headerBlock(text), /\r\nMessage-ID: <01JMIME\.message-id@example\.com>/);
});

test('MIME: an inline image goes in multipart/related with its HTML, a file beside them', async () => {
  const image = {
    inline: true,
    filename: 'logo.png',
    content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    contentType: 'image/png',
    contentId: 'logo@example.com',
  };
  const file = {
    inline: false,
    filename: 'report.pdf',
    content: new Uint8Array([0x25, 0x50]),
    contentType: 'application/pdf',
    contentId: '',
  };
  const html = { text: 'Hi', html: '<p>Hi <img src="cid:logo@example.com"></p>' };

  const onlyInline = await wire(
    createMessage({ ...base, subject: 'a', content: html, attachments: [image] }),
  );
  assert.match(
    headerBlock(onlyInline),
    /^Content-Type: multipart\/related; boundary="[^"]+"; type="multipart\/alternative"$/m,
  );
  const parsedInline = await PostalMime.parse(onlyInline);
  assert.strictEqual(parsedInline.html.trim(), html.html);
  assert.deepStrictEqual(
    parsedInline.attachments.map((part) => [part.contentId, part.related]),
    [['<logo@example.com>', true]],
  );

  const both = await wire(
    createMessage({ ...base, subject: 'a', content: html, attachments: [image, file] }),
  );
  assert.match(headerBlock(both), /^Content-Type: multipart\/mixed; boundary=/m);
  // The related part, with the image in it, comes first; the file after it.
  const related = both.indexOf('Content-Type: multipart/related;');
  assert.ok(related > 0 && related < both.indexOf('name="logo.png"'));
  assert.ok(both.indexOf('name="logo.png"') < both.indexOf('name="report.pdf"'));
  const parsedBoth = await PostalMime.parse(both);
  assert.deepStrictEqual(
    parsedBoth.attachments.map((part) => [part.filename, part.related === true]),
    [
      ['logo.png', true],
      ['report.pdf', false],
    ],
  );
});

test('MIME: a field name too long for encoded text after it puts the text on the next line', async () => {
  const name = `X-${'Long-'.repeat(12)}Name`;
  // A Headers object takes Latin-1 text only.
  const value = 'Café crème brûlée, déjà vu';
  const text = await wire(createMessage({ ...base, subject: 'a', headers: { [name]: value } }));
  const lines = headerBlock(text).split('\r\n');
  const at = lines.findIndex((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  assert.strictEqual(lines[at].toLowerCase(), `${name.toLowerCase()}:`);
  for (let i = at + 1; lines[i]?.startsWith(' '); i++) assert.ok(lines[i].length <= 76, lines[i]);
  const parsed = await PostalMime.parse(text);
  const header = parsed.headers.find((field) => field.key === name.toLowerCase());
  // Adjacent encoded words decode as one text (RFC 2047 §6.2), split only at
  // whole characters.
  const decoded = header.value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, encoded) => Buffer.from(encoded, 'base64').toString());
  assert.strictEqual(decoded, value);
});
