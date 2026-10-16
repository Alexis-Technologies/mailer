// Ported from upyo v0.7.0 (packages/mime/src/compose.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessage } = require('../../src/core/message.js');
const { readAttachmentContent } = require('../../src/core/attachment.js');
const { composeMessage } = require('../../src/mime/index.js');
const PostalMime = require('postal-mime');
const { RawMessageValidationError } = require('../../src/core/raw-message.js');
const { createRawMessagePlan, iterateRawMessage } = require('../../src/core/raw-message.js');
const { MimeAttachmentReplayError } = require('../../src/mime/index.js');
const {
  TEST_DKIM_ED25519_PRIVATE_KEY,
  TEST_DKIM_ED25519_PUBLIC_KEY,
  TEST_DKIM_PRIVATE_KEY,
  TEST_DKIM_PUBLIC_KEY,
} = require('../helpers/mime/dkim-test-keys.js');
const { verifyDkim } = require('../helpers/mime/verify-dkim.js');

test('compose without opening attachments; replay stable MIME and Bcc envelope', async () => {
  let reads = 0;
  const message = createMessage({
    from: 'from@example.com',
    to: 'to@example.com',
    bcc: 'blind@example.com',
    subject: 'Hello',
    content: { text: 'first\r\nsecond' },
    attachments: {
      filename: 'a',
      contentType: 'text/plain',
      inline: false,
      contentId: 'a',
      content: async function* () {
        reads++;
        yield new TextEncoder().encode('hello');
      },
    },
  });
  const raw = await composeMessage(message);
  assert.equal(reads, 0);
  assert.deepEqual(raw.envelope.to, ['to@example.com', 'blind@example.com']);
  const [a, b] = await Promise.all([
    readAttachmentContent(raw.content),
    readAttachmentContent(raw.content),
  ]);
  assert.deepEqual(a, b);
  assert.equal(reads, 2);
  assert.ok(!new TextDecoder().decode(a).includes('Bcc:'));
  assert.ok(new TextDecoder().decode(a).endsWith('\r\n'));
  assert.equal(raw.encoding, '7bit');
});

const message = () =>
  createMessage({
    from: 'from@example.com',
    to: 'to@example.com',
    subject: '안녕하세요',
    content: { text: 'Hello' },
  });
const signature = {
  signingDomain: 'example.com',
  selector: 'test',
  privateKey: TEST_DKIM_PRIVATE_KEY,
};
const attachment = {
  filename: '파일.bin',
  contentType: 'application/octet-stream',
  contentId: 'inline',
  inline: true,
};
const collect = async (raw, signal) =>
  new TextDecoder().decode(await readAttachmentContent(raw.content, signal));

for (const kind of ['bytes', 'promise', 'blob', 'factory']) {
  test(`independent parser decodes Unicode, alternatives and ${kind} attachments`, async () => {
    const bytes = Uint8Array.from({ length: 65539 }, (_, i) => i % 251);
    const source =
      kind === 'bytes'
        ? bytes
        : kind === 'promise'
          ? Promise.resolve(bytes)
          : kind === 'blob'
            ? new Blob([bytes])
            : async function* () {
                const reused = new Uint8Array(13);
                for (let offset = 0; offset < bytes.length; offset += reused.length) {
                  const slice = bytes.subarray(offset, offset + reused.length);
                  reused.set(slice);
                  yield reused.subarray(0, slice.length);
                }
              };
    const raw = await composeMessage({
      ...message(),
      content: { text: '한글\r\nNext \nend\r', html: '<b>한글</b>' },
      attachments: [{ ...attachment, content: source }],
    });
    const wire = await collect(raw);
    const parsed = await PostalMime.parse(wire);
    assert.equal(parsed.subject, '안녕하세요');
    assert.equal(parsed.html?.trim(), '<b>한글</b>');
    assert.ok(parsed.text?.startsWith('한글\nNext \nend'));
    assert.equal(parsed.attachments[0].filename, '파일.bin');
    assert.equal(parsed.attachments[0].contentId, '<inline>');
    assert.deepEqual(new Uint8Array(parsed.attachments[0].content), bytes);
    assert.ok(wire.includes('multipart/alternative'));
    for await (const chunk of iterateRawMessage(createRawMessagePlan(raw))) {
      assert.ok(chunk.length <= 32768);
    }
  });
}

for (const method of ['REQUEST', 'REPLY', 'CANCEL']) {
  test(`calendar ${method} preserves calendar CRLF`, async () => {
    const calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Upyo//EN\r\nMETHOD:${method}\r\nEND:VCALENDAR\r\n`;
    const raw = await composeMessage({
      ...message(),
      calendar: { method, content: calendar },
    });
    const wire = await collect(raw);
    assert.ok(wire.includes(`text/calendar; charset=utf-8; method=${method}`));
    assert.ok(wire.indexOf('text/plain') < wire.indexOf('text/calendar'));
    const parsed = await PostalMime.parse(wire);
    assert.equal(
      new TextDecoder().decode(parsed.attachments[0].content),
      calendar.replace(/\r\n/g, '\n'),
    );
    const payload = wire
      .split(`method=${method}\r\nContent-Transfer-Encoding: base64\r\n\r\n`)[1]
      .split('\r\n--')[0];
    assert.equal(atob(payload.replace(/\s/g, '')), calendar);
  });
}

for (const bodyMode of ['buffered', 'streaming']) {
  for (const algorithm of ['rsa-sha256', 'ed25519-sha256']) {
    for (const canonicalization of [
      'simple/simple',
      'simple/relaxed',
      'relaxed/simple',
      'relaxed/relaxed',
    ]) {
      test(`verify composed ${algorithm} ${canonicalization} ${bodyMode}`, async () => {
        let reads = 0;
        const raw = await composeMessage(
          {
            ...message(),
            attachments: [
              {
                ...attachment,
                content: async function* () {
                  reads++;
                  yield new Uint8Array([1, 2, 3]);
                },
              },
            ],
          },
          {
            dkim: {
              bodyMode,
              signatures: [
                {
                  ...signature,
                  algorithm,
                  canonicalization,
                  privateKey:
                    algorithm === 'rsa-sha256'
                      ? TEST_DKIM_PRIVATE_KEY
                      : TEST_DKIM_ED25519_PRIVATE_KEY,
                },
              ],
            },
          },
        );
        assert.equal(reads, 1);
        const wire = await collect(raw);
        verifyDkim(
          wire,
          algorithm === 'rsa-sha256' ? TEST_DKIM_PUBLIC_KEY : TEST_DKIM_ED25519_PUBLIC_KEY,
        );
        assert.equal(await collect(raw), wire);
        assert.equal(reads, bodyMode === 'buffered' ? 1 : 3);
      });
    }
  }
}

test('buffered signed readers cannot mutate retained chunks', async () => {
  const raw = await composeMessage(message(), {
    dkim: { signatures: [signature] },
  });
  const expected = await collect(raw);
  for await (const chunk of raw.content()) chunk.fill(0);
  assert.equal(await collect(raw), expected);
});

test('streaming replay mismatch is a raw validation error', async () => {
  let reads = 0;
  const raw = await composeMessage(
    {
      ...message(),
      attachments: [
        {
          ...attachment,
          content: async function* () {
            yield new Uint8Array([reads++]);
          },
        },
      ],
    },
    { dkim: { bodyMode: 'streaming', signatures: [signature] } },
  );
  await assert.rejects(
    collect(raw),
    (error) =>
      error instanceof MimeAttachmentReplayError &&
      error instanceof RawMessageValidationError &&
      error.field === 'content',
  );
});

test('unsigned compose does not await promised bytes and observes later rejection', async () => {
  let reject;
  const error = new TypeError('Attachment failed.');
  // oxlint-disable-next-line promise/param-names -- upstream
  const content = new Promise((_, r) => {
    reject = r;
  });
  const raw = await composeMessage({
    ...message(),
    attachments: [{ ...attachment, content }],
  });
  reject(error);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(collect(raw), (actual) => actual === error);
});

test('snapshots metadata and signing configuration before awaiting bytes', async () => {
  let resolve;
  const headers = new Headers({ 'X-Test': 'before' });
  const date = new Date('2026-09-01T00:00:00Z');
  const signatures = [{ ...signature, headerFields: ['from', 'subject'] }];
  const dkim = { signatures };
  const composing = composeMessage(
    {
      ...message(),
      headers,
      date,
      attachments: [
        {
          ...attachment,
          // oxlint-disable-next-line promise/param-names -- upstream
          content: new Promise((r) => {
            resolve = r;
          }),
        },
      ],
    },
    { dkim },
  );
  headers.set('X-Test', 'after');
  date.setUTCFullYear(2000);
  signatures[0].selector = 'changed';
  signatures[0].headerFields.push('date');
  resolve(new Uint8Array());
  const wire = await collect(await composing);
  assert.ok(wire.includes('x-test: before'));
  assert.ok(wire.includes('2026'));
  assert.ok(wire.includes('s=test;'));
  assert.ok(wire.includes('h=from:subject;'));
});

test('nested and signed Unicode headers determine MIME encoding', async () => {
  assert.equal(
    (
      await composeMessage({
        ...message(),
        attachments: [
          {
            ...attachment,
            contentId: '한글',
            content: new Uint8Array(),
          },
        ],
      })
    ).encoding,
    'utf8',
  );
  assert.equal(
    (
      await composeMessage(message(), {
        dkim: { signatures: [{ ...signature, signingDomain: '한글.example' }] },
      })
    ).encoding,
    'utf8',
  );
  // Changed after the port: a signing domain of 1000 characters is no domain
  // name and is refused as such; an h= of many fields still makes a signature
  // line longer than 998 octets.
  await assert.rejects(
    composeMessage(message(), {
      dkim: { signatures: [{ ...signature, signingDomain: 'x'.repeat(1000) }] },
    }),
    TypeError,
  );
  await assert.rejects(
    composeMessage(message(), {
      dkim: { signatures: [{ ...signature, headerFields: Array(100).fill('x-long-field-name') }] },
    }),
    RangeError,
  );
});

test('invalid derived envelope uses core raw validation', async () => {
  await assert.rejects(
    composeMessage({ ...message(), recipients: [] }),
    (error) => error instanceof RawMessageValidationError && error.field === 'envelope',
  );
});
