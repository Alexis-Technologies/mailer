// Ported from message-segment-calculator v1.3.0 (tests/index.test.js)
// https://github.com/TwilioDevEd/message-segment-calculator — MIT, Copyright 2021 Twilio Inc
// Also ported from split-sms v0.1.7 (test/splitter.test.js, test/testdata/gsm.test.json,
// test/testdata/unicode.test.json)
// https://github.com/Codesleuth/split-sms — MIT, Copyright 2014 David Wood
// The cases of upstream's TestData and of split-sms, against countSegments:
// the bits of a message of upstream are its units (7 a septet, 16 a code
// unit) and its unicodeScalars its characters; the bytes of split-sms are
// septets, or two a code unit. The messages of split-sms are built rather
// than copied: only their characters count. Left out: Smart Encoding, which
// is not ported, and the two cases of split-sms that force GSM-7 on a text of
// UCS-2, each character a space, as countSegments takes the encoding a text
// needs.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { countSegments } = require('../../src/channels/index.js');

const TestData = [
  {
    testDescription: 'GSM-7 in one segment',
    body: '1234567890'.repeat(16),
    encoding: 'GSM-7',
    segments: 1,
    messageSize: 1120,
    unicodeScalars: 160,
  },
  {
    testDescription: 'GSM-7 in two segments',
    body: `${'1234567890'.repeat(16)}1`,
    encoding: 'GSM-7',
    segments: 2,
    messageSize: 1127,
    unicodeScalars: 161,
  },
  {
    testDescription: 'GSM-7 in three segments',
    body: `${'1234567890'.repeat(30)}1234567`,
    encoding: 'GSM-7',
    segments: 3,
    messageSize: 2149,
    unicodeScalars: 307,
  },
  {
    testDescription: 'UCS-2 message in one segment',
    body: `😜${'23456789012345678901234567890123456789012345678901234567890123456789'}`,
    encoding: 'UCS-2',
    segments: 1,
    messageSize: 1120,
    unicodeScalars: 69,
  },
  {
    testDescription: 'UCS-2 message in two segments',
    body: `😜${'234567890123456789012345678901234567890123456789012345678901234567890'}`,
    encoding: 'UCS-2',
    segments: 2,
    messageSize: 1136,
    unicodeScalars: 70,
  },
  {
    testDescription: 'UCS-2 message in three segments',
    body: `😜${'2345678901'}${'2345678901'.repeat(12)}234`,
    encoding: 'UCS-2',
    segments: 3,
    messageSize: 2160,
    unicodeScalars: 134,
  },
  {
    testDescription: 'UCS-2 with two bytes extended characters in one segments boundary',
    body: `🇮🇹${'2345678901'.repeat(6)}234567`,
    encoding: 'UCS-2',
    segments: 1,
    messageSize: 1120,
    unicodeScalars: 68,
  },
  {
    testDescription: 'UCS-2 with extended characters in two segments boundary',
    body: `🇮🇹${'2345678901'.repeat(6)}2345678`,
    encoding: 'UCS-2',
    segments: 2,
    messageSize: 1136,
    unicodeScalars: 69,
  },
  {
    testDescription: 'UCS-2 with four bytes extended characters in one segments boundary',
    body: `🏳️‍🌈${'2345678901'.repeat(6)}2345`,
    encoding: 'UCS-2',
    segments: 1,
    messageSize: 1120,
    unicodeScalars: 68,
  },
  {
    testDescription: 'UCS-2 with four bytes extended characters in two segments boundary',
    body: `🏳️‍🌈${'2345678901'.repeat(6)}23456`,
    encoding: 'UCS-2',
    segments: 2,
    messageSize: 1136,
    unicodeScalars: 69,
  },
];

describe('Basic tests', () => {
  for (const testMessage of TestData) {
    it(testMessage.testDescription, () => {
      const segmented = countSegments(testMessage.body);
      assert.strictEqual(segmented.encoding, testMessage.encoding);
      assert.strictEqual(segmented.segments, testMessage.segments);
      const bits = segmented.units * (segmented.encoding === 'GSM-7' ? 7 : 16);
      assert.strictEqual(bits, testMessage.messageSize);
      assert.strictEqual(segmented.characters, testMessage.unicodeScalars);
    });
  }
});

const ext = '\f|^€{}[~]\\';
const gsm = (length) => 'x'.repeat(length);

const gsmTestData = [
  { description: 'Split 160 character message', message: gsm(160), parts: 1, totalBytes: 160 },
  { description: 'Split 161 character message', message: gsm(161), parts: 2, totalBytes: 161 },
  { description: 'Split 306 character message', message: gsm(306), parts: 2, totalBytes: 306 },
  { description: 'Split 307 character message', message: gsm(307), parts: 3, totalBytes: 307 },
  {
    description: 'Split 160 character message ending with an extended character',
    message: `${gsm(159)}€`,
    parts: 2,
    totalBytes: 161,
  },
  {
    // The escape does not fit after 152 septets: the character goes whole to
    // the next part, 152 and 9.
    description: 'Split 160 character message with an extended character at the 153rd index',
    message: `${gsm(152)}€${gsm(7)}`,
    parts: 2,
    totalBytes: 161,
  },
  {
    description: 'Split 80 character message with all extended characters',
    message: ext.repeat(8),
    parts: 1,
    totalBytes: 160,
  },
  {
    description: 'Split 304 character message with all extended characters',
    message: ext.repeat(31).slice(0, 304),
    parts: 4,
    totalBytes: 608,
  },
  { description: 'Split empty message', message: '', parts: 1, totalBytes: 0 },
];

const unicodeTestData = [
  {
    description: 'Split 1 character message of 4-byte characters',
    message: '🐳',
    parts: 1,
    totalBytes: 4,
    totalLength: 1,
  },
  {
    description: 'Split 3 character message of 4-byte and 2-byte characters',
    message: '🐳☃🐳',
    parts: 1,
    totalBytes: 10,
    totalLength: 3,
  },
  {
    description: 'Split full single message of 2-byte Basic Multilingual Plane characters',
    message: '☃'.repeat(70),
    parts: 1,
    totalBytes: 140,
    totalLength: 70,
  },
  {
    description: 'Split full single message of 4-byte Supplementary Multilingual Plane characters',
    message: '🐳'.repeat(35),
    parts: 1,
    totalBytes: 140,
    totalLength: 35,
  },
  {
    description:
      'Split full single message of mixed Supplementary Multilingual Plane and Basic Multilingual Plane characters',
    message: `${'☃🐳'.repeat(23)}☃`,
    parts: 1,
    totalBytes: 140,
    totalLength: 47,
  },
  {
    description: 'Split 71 char multipart message of 2-byte Basic Multilingual Plane characters',
    message: '☃'.repeat(71),
    parts: 2,
    totalBytes: 142,
    totalLength: 71,
  },
  {
    description:
      'Split 70 char multipart message of 2-byte Basic Multilingual Plane characters with one 4-part Supplementary Multilingual Plane character at the 67th index',
    message: `${'☃'.repeat(66)}🐳${'☃'.repeat(3)}`,
    parts: 2,
    totalBytes: 142,
    totalLength: 70,
  },
  {
    description:
      'Split 35 char multipart message of 4-byte Supplementary Multilingual Plane characters with one 2-part Basic Multilingual Plane character at the 34th index',
    message: `${'🐳'.repeat(33)}☃🐳`,
    parts: 1,
    totalBytes: 138,
    totalLength: 35,
  },
  {
    description:
      'Split 36 char multipart message of 4-byte Supplementary Multilingual Plane characters with one 2-part Basic Multilingual Plane character at the 34th index',
    message: `${'🐳'.repeat(33)}☃${'🐳'.repeat(2)}`,
    parts: 2,
    totalBytes: 142,
    totalLength: 36,
  },
  { description: 'Split empty message', message: '', parts: 1, totalBytes: 0, totalLength: 0 },
];

describe('SMS Splitter', () => {
  describe('GSM Message', () => {
    for (const testData of gsmTestData) {
      it(testData.description, () => {
        const result = countSegments(testData.message);
        assert.strictEqual(result.encoding, 'GSM-7');
        assert.strictEqual(result.segments, testData.parts);
        assert.strictEqual(result.units, testData.totalBytes);
        assert.strictEqual(result.characters, testData.message.length);
      });
    }
  });

  describe('Unicode Message', () => {
    for (const testData of unicodeTestData) {
      it(testData.description, () => {
        const result = countSegments(testData.message);
        if (testData.message !== '') assert.strictEqual(result.encoding, 'UCS-2');
        assert.strictEqual(result.segments, testData.parts);
        assert.strictEqual(result.units * 2, testData.totalBytes);
        assert.strictEqual(result.characters, testData.totalLength);
      });
    }
  });
});
