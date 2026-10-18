// Not ported: tests of the List-* header fields of RFC 2369 and RFC 2919 and
// of one-click unsubscription (RFC 8058), ported from nodemailer and unemail.
const { test } = require('node:test');
const assert = require('node:assert');
const PostalMime = require('postal-mime');
const { createMessage } = require('../../index.js');
const { readAttachmentContent } = require('../../src/core/attachment.js');
const { listFieldsOf } = require('../../src/core/list.js');
const { composeMessage } = require('../../src/mime/index.js');
const { convertMessage: convertSes } = require('../../src/ses/message-converter.js');
const { createSesConfig } = require('../../src/ses/config.js');
const {
  TEST_DKIM_PRIVATE_KEY,
  TEST_DKIM_PUBLIC_KEY,
} = require('../helpers/mime/dkim-test-keys.js');
const { verifyDkim } = require('../helpers/mime/verify-dkim.js');

const fieldsOf = (list) => {
  const fields = {};
  for (const field of listFieldsOf(list)) fields[field.name] = field.value;
  return fields;
};

const message = (list, headers) =>
  createMessage({
    from: 'news@example.com',
    to: 'reader@example.com',
    subject: 'Weekly',
    content: { text: 'Hello' },
    headers,
    list,
  });

test('List: URLs go in angle brackets, a bare address as mailto, one field each', () => {
  assert.deepStrictEqual(
    fieldsOf({
      help: 'https://example.com/help',
      unsubscribe: ['https://example.com/u?id=1', 'unsub@example.com?subject=stop'],
      subscribe: 'mailto:join@example.com',
      post: 'list@example.com',
      owner: { url: 'mailto:owner@example.com', comment: 'Ann (owner)' },
      archive: 'http://example.com/archive',
    }),
    {
      'List-Help': '<https://example.com/help>',
      'List-Unsubscribe': '<https://example.com/u?id=1>, <mailto:unsub@example.com?subject=stop>',
      'List-Subscribe': '<mailto:join@example.com>',
      'List-Post': '<mailto:list@example.com>',
      'List-Owner': '<mailto:owner@example.com> (Ann \\(owner\\))',
      'List-Archive': '<http://example.com/archive>',
    },
  );
});

test('List: List-Id is a dot-atom with a namespace and an optional name', () => {
  assert.deepStrictEqual(fieldsOf({ id: 'news.example.com' }), {
    'List-Id': '<news.example.com>',
  });
  assert.deepStrictEqual(fieldsOf({ id: { id: 'news.example.com', name: 'Weekly News' } }), {
    'List-Id': 'Weekly News <news.example.com>',
  });
  assert.deepStrictEqual(fieldsOf({ id: { id: 'news.example.com', name: 'News, weekly' } }), {
    'List-Id': '"News, weekly" <news.example.com>',
  });
  for (const id of ['news', 'news..example.com', 'news example.com', 'новини.example.com']) {
    assert.throws(() => listFieldsOf({ id }), /Invalid list ID/, id);
  }
  assert.throws(
    () => listFieldsOf({ id: { id: 'news.example.com', name: 'Новини' } }),
    /list name must be printable ASCII/,
  );
});

test('List: one-click adds List-Unsubscribe-Post and needs an https URL', () => {
  assert.deepStrictEqual(
    fieldsOf({ unsubscribe: ['mailto:u@example.com', 'https://example.com/u'], oneClick: true }),
    {
      'List-Unsubscribe': '<mailto:u@example.com>, <https://example.com/u>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  );
  // unemail turned one-click on for any URL; RFC 8058 §3.1 asks for https.
  assert.throws(
    () => listFieldsOf({ unsubscribe: 'http://example.com/u', oneClick: true }),
    /needs an https URL/,
  );
  assert.throws(() => listFieldsOf({ oneClick: true }), /needs an https URL/);
  assert.throws(
    () => listFieldsOf({ unsubscribe: 'https://example.com/u', oneClick: 'yes' }),
    /must be a boolean/,
  );
  assert.deepStrictEqual(fieldsOf({ unsubscribe: 'https://example.com/u', oneClick: false }), {
    'List-Unsubscribe': '<https://example.com/u>',
  });
});

test('List: a URL that could end the field or the brackets is refused', () => {
  // unemail built these fields after its line-break check, so a CRLF in the
  // URL added header fields; nodemailer stripped the characters silently.
  const broken = [
    'https://example.com/u\r\nBcc: victim@example.com',
    'https://example.com/u>, <https://evil.example',
    'https://example.com/a b',
    'https://example.com/\u0000',
    '',
  ];
  for (const url of broken) {
    assert.throws(() => listFieldsOf({ unsubscribe: url }), /Invalid List-Unsubscribe URL/, url);
  }
  assert.throws(() => listFieldsOf({ help: 'javascript:alert(1)' }), /http, https or mailto/);
  assert.throws(() => listFieldsOf({ help: 'ftp://example.com/help' }), /http, https or mailto/);
  // nodemailer guessed http:// for a URL without a scheme.
  assert.throws(() => listFieldsOf({ help: 'example.com/help' }), /Invalid List-Help URL/);
  assert.throws(() => listFieldsOf({ help: { comment: 'no url' } }), /Invalid List-Help URL/);
});

test('List: a comment beyond printable ASCII, an unknown key or a non-object is refused', () => {
  assert.throws(
    () => listFieldsOf({ help: { url: 'https://example.com', comment: 'line\r\nbreak' } }),
    /comment must be printable ASCII/,
  );
  assert.throws(
    () => listFieldsOf({ help: { url: 'https://example.com', comment: 'Довідка' } }),
    /comment must be printable ASCII/,
  );
  assert.throws(() => listFieldsOf({ unsubcribe: 'https://example.com' }), /Unknown list field/);
  assert.throws(() => listFieldsOf('https://example.com'), /must be an object/);
  assert.throws(() => listFieldsOf(['https://example.com']), /must be an object/);
  assert.deepStrictEqual(listFieldsOf(undefined), []);
  assert.deepStrictEqual(listFieldsOf({ help: [], unsubscribe: null }), []);
});

test('List: URLs are written as the URL parser serializes them', () => {
  assert.deepStrictEqual(fieldsOf({ help: 'HTTPS://Bücher.example/Hilfe?ä=1' }), {
    'List-Help': '<https://xn--bcher-kva.example/Hilfe?%C3%A4=1>',
  });
});

test('List: createMessage puts the fields into the headers, once', () => {
  const list = { unsubscribe: 'https://example.com/u', oneClick: true };
  const created = message(list);
  assert.strictEqual(created.headers.get('List-Unsubscribe'), '<https://example.com/u>');
  assert.strictEqual(created.headers.get('List-Unsubscribe-Post'), 'List-Unsubscribe=One-Click');
  assert.throws(
    () => message(list, { 'List-Unsubscribe': '<https://example.com/other>' }),
    /List-Unsubscribe is given both in list and in headers/,
  );
  // A field the list leaves alone may still come through the headers.
  const custom = message({ id: 'news.example.com' }, { 'List-Unsubscribe': '<mailto:u@x.com>' });
  assert.strictEqual(custom.headers.get('List-Unsubscribe'), '<mailto:u@x.com>');
});

test('List: the composed message carries the fields, and DKIM signs both of one-click', async () => {
  const raw = await composeMessage(
    message({
      id: { id: 'news.example.com', name: 'Weekly News' },
      unsubscribe: ['https://example.com/u?id=1', 'mailto:unsub@example.com'],
      oneClick: true,
    }),
    {
      dkim: {
        signatures: [
          { signingDomain: 'example.com', selector: 'test', privateKey: TEST_DKIM_PRIVATE_KEY },
        ],
      },
    },
  );
  const bytes = await readAttachmentContent(raw.content);
  const wire = new TextDecoder().decode(bytes);
  verifyDkim(wire, TEST_DKIM_PUBLIC_KEY);
  const signature = /^DKIM-Signature:[\s\S]*?\r\n(?![ \t])/m.exec(wire)[0].replace(/\r\n\s/g, '');
  assert.match(signature, /h=[^;]*:list-unsubscribe:list-unsubscribe-post;/);
  const parsed = await PostalMime.parse(bytes);
  const headers = Object.create(null);
  for (const header of parsed.headers) headers[header.key] = header.value;
  assert.strictEqual(
    headers['list-unsubscribe'],
    '<https://example.com/u?id=1>, <mailto:unsub@example.com>',
  );
  assert.strictEqual(headers['list-unsubscribe-post'], 'List-Unsubscribe=One-Click');
  assert.strictEqual(headers['list-id'], 'Weekly News <news.example.com>');
});

test('List: a provider that takes custom headers gets the fields', async () => {
  const config = createSesConfig({
    authentication: { type: 'credentials', accessKeyId: 'AKID', secretAccessKey: 'secret' },
  });
  const request = await convertSes(
    message({ unsubscribe: 'https://example.com/u', oneClick: true }),
    config,
  );
  const headers = Object.create(null);
  for (const header of request.Content.Simple.Headers) headers[header.Name] = header.Value;
  assert.strictEqual(headers['list-unsubscribe'], '<https://example.com/u>');
  assert.strictEqual(headers['list-unsubscribe-post'], 'List-Unsubscribe=One-Click');
});
