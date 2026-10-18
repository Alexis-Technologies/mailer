// Not ported: the transfer encoding of a text body, chosen by its content as
// nodemailer chooses it (upyo wrote every body quoted-printable). Each body is
// read back with postal-mime, an independent parser.
const { test } = require('node:test');
const assert = require('node:assert');
const PostalMime = require('postal-mime');
const { createMessage, readAttachmentContent } = require('../../index.js');
const { composeMessage } = require('../../src/mime/index.js');
const {
  TEST_DKIM_PRIVATE_KEY,
  TEST_DKIM_PUBLIC_KEY,
} = require('../helpers/mime/dkim-test-keys.js');
const { verifyDkim } = require('../helpers/mime/verify-dkim.js');

const compose = async (content, options) => {
  const message = createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Encoding',
    content,
  });
  const composed = await composeMessage(message, options);
  const bytes = await readAttachmentContent(composed.content);
  return { bytes, wire: new TextDecoder().decode(bytes) };
};

// postal-mime gives the text with LF line breaks and the line break the
// writer ends a part with.
const lines = (text) => text.replace(/\r\n|\r|\n/g, '\n').replace(/\n+$/, '');

const encodingsOf = (wire) => {
  const encodings = [];
  for (const match of wire.matchAll(/^Content-Transfer-Encoding: (\S+)\r$/gm)) {
    encodings.push(match[1]);
  }
  return encodings;
};

test('Encoding: short ASCII lines go 7bit, as written', async () => {
  const text = 'Hello Bob,\r\n\r\nSee you at 10:00. A = B, 50% off.\r\n';
  const { bytes, wire } = await compose({ text });
  assert.deepStrictEqual(encodingsOf(wire), ['7bit']);
  assert.ok(wire.endsWith(`\r\n\r\n${text}\r\n`));
  assert.strictEqual(lines((await PostalMime.parse(bytes)).text), lines(text));
});

test('Encoding: a line past 76 columns, a control or trailing space is not 7bit', async () => {
  for (const text of ['a'.repeat(77), 'tab\tand bell\u0007', 'trailing space \r\nnext', 'end\t']) {
    const { bytes, wire } = await compose({ text });
    assert.deepStrictEqual(encodingsOf(wire), ['quoted-printable'], JSON.stringify(text));
    for (const line of wire.split('\r\n')) assert.ok(line.length <= 998);
    assert.strictEqual(lines((await PostalMime.parse(bytes)).text), lines(text));
  }
  // 76 columns still fit.
  assert.deepStrictEqual(encodingsOf((await compose({ text: 'a'.repeat(76) })).wire), ['7bit']);
});

test('Encoding: mostly Latin text goes quoted-printable, the rest Base64', async () => {
  const french = 'Le cœur a ses raisons que la raison ne connaît point.';
  const ukrainian = 'Серце має свої причини, яких розум не знає.';
  const japanese = '心には理性の知らない理由がある。';
  const cases = [
    [french, 'quoted-printable'],
    [ukrainian, 'base64'],
    [japanese, 'base64'],
    ['Hi 👋🌍💬', 'base64'],
  ];
  for (const [text, encoding] of cases) {
    const { bytes, wire } = await compose({ text, html: `<p>${text}</p>` });
    assert.deepStrictEqual(encodingsOf(wire), [encoding, encoding], text);
    const parsed = await PostalMime.parse(bytes);
    assert.strictEqual(lines(parsed.text), text);
    assert.strictEqual(lines(parsed.html), `<p>${text}</p>`);
  }
});

test('Encoding: Cyrillic in Base64 is far shorter than it was in quoted-printable', async () => {
  const text = 'Серце має свої причини, яких розум не знає. '.repeat(40);
  const { wire } = await compose({ text });
  const body = wire.slice(wire.indexOf('\r\n\r\n') + 4);
  const utf8Length = Buffer.byteLength(text);
  // Base64 is 4/3 of the bytes plus line breaks; quoted-printable took about 3.
  assert.ok(body.length < utf8Length * 1.4, `${body.length} for ${utf8Length} bytes`);
});

test('Encoding: a bare LF or CR becomes CRLF before encoding', async () => {
  const { bytes, wire } = await compose({ text: 'one\ntwo\rthree\r\nfour' });
  assert.deepStrictEqual(encodingsOf(wire), ['7bit']);
  assert.ok(wire.endsWith('\r\n\r\none\r\ntwo\r\nthree\r\nfour\r\n'));
  assert.ok(!wire.includes('=0A'));
  assert.strictEqual(lines((await PostalMime.parse(bytes)).text), 'one\ntwo\nthree\nfour');
  const latin = await compose({ text: 'café\nnext' });
  assert.ok(!latin.wire.includes('=0A'));
  assert.ok(latin.wire.includes('caf=C3=A9\r\nnext'));
});

test('Encoding: an empty body goes 7bit', async () => {
  assert.deepStrictEqual(encodingsOf((await compose({})).wire), ['7bit']);
  assert.deepStrictEqual(encodingsOf((await compose({ text: '' })).wire), ['7bit']);
});

test('Encoding: DKIM verifies over each encoding and both canonicalizations', async () => {
  for (const canonicalization of ['simple/simple', 'relaxed/relaxed']) {
    for (const text of ['plain ascii', 'trailing space \r\nx', 'Серце має свої причини']) {
      const { wire } = await compose(
        { text },
        {
          dkim: {
            signatures: [
              {
                signingDomain: 'example.com',
                selector: 'test',
                privateKey: TEST_DKIM_PRIVATE_KEY,
                canonicalization,
              },
            ],
          },
        },
      );
      verifyDkim(wire, TEST_DKIM_PUBLIC_KEY);
    }
  }
});
