// Paths of the ported core (src/core/) that upstream's suites leave out.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  analyzeRawMessage,
  classifyHttpStatus,
  classifyReceiptError,
  comparePriority,
  createFailedReceipt,
  createMessage,
  createRawMessagePlan,
  createReceiptError,
  isEmailAddress,
  iterateAttachmentContent,
  iterateRawMessage,
  RawMessageValidationError,
  readAttachmentContent,
  resolveCalendarContent,
} = require('../../index.js');

const base = {
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
};

test('Address: a value that is not a string, or a bad quoted local part, is no address', () => {
  assert.strictEqual(isEmailAddress(''), false);
  assert.strictEqual(isEmailAddress(42), false);
  assert.strictEqual(isEmailAddress('"\ud800"@example.com'), false);
  assert.strictEqual(isEmailAddress('"a\\\u0001"@example.com'), false);
  assert.strictEqual(isEmailAddress('alex@[127.0.0.1]'), true);
});

test('Message: an attachment that is neither a File nor an Attachment is rejected', () => {
  assert.throws(() => createMessage({ ...base, attachments: [{}] }), {
    name: 'TypeError',
    message: 'Invalid attachment: {}',
  });
  assert.throws(() => createMessage({ ...base, date: '2020-01-01' }), {
    message: 'Invalid date: "2020-01-01"',
  });
});

test('Calendar: the content must begin with a VCALENDAR object', () => {
  assert.throws(() => resolveCalendarContent({ content: 'BEGIN:VEVENT\r\nEND:VEVENT\r\n' }), {
    name: 'TypeError',
    message: 'The calendar content begins with "VEVENT" rather than a VCALENDAR object.',
  });
});

test('Priority: high sorts first, low last', () => {
  const sorted = ['normal', 'low', 'high', 'low', 'normal', 'high'].sort(comparePriority);
  assert.deepStrictEqual(sorted, ['high', 'high', 'normal', 'normal', 'low', 'low']);
});

test('Receipt: HTTP statuses map to categories', () => {
  assert.deepStrictEqual(classifyHttpStatus(408), { category: 'timeout', retryable: true });
  assert.deepStrictEqual(classifyHttpStatus(504), { category: 'timeout', retryable: true });
  assert.deepStrictEqual(classifyHttpStatus(422), { category: 'validation', retryable: false });
  assert.deepStrictEqual(classifyHttpStatus(302), { category: 'unknown', retryable: false });
});

test('Receipt: error messages map to categories by keyword', () => {
  const cases = [
    ['Invalid recipient', 'validation', false],
    ['Service Unavailable', 'service-unavailable', true],
    ['Internal Server Error', 'server-error', true],
    ['Unsupported option', 'configuration', false],
    ['Something odd', 'unknown', false],
  ];
  for (const [message, category, retryable] of cases) {
    assert.deepStrictEqual(
      classifyReceiptError(new Error(message)),
      { category, retryable, code: category },
      message,
    );
  }
  // A plain object is read by its properties; a null name counts as none.
  assert.strictEqual(
    classifyReceiptError({ message: 'Unsupported', name: null }).category,
    'configuration',
  );
});

test('Receipt: an explicit category is also the code, and a ReceiptError makes a receipt', () => {
  assert.deepStrictEqual(createReceiptError('Bounced', { category: 'rejected' }), {
    message: 'Bounced',
    category: 'rejected',
    code: 'rejected',
    retryable: false,
  });
  const error = createReceiptError('Quota exceeded');
  const receipt = createFailedReceipt(error, { timestamp: '2026-01-01T00:00:00.000Z' });
  assert.deepStrictEqual(receipt, {
    successful: false,
    errorMessages: ['Quota exceeded'],
    errors: [error],
    retryable: true,
    timestamp: '2026-01-01T00:00:00.000Z',
  });
  const mixed = createFailedReceipt(['Timed out', error], { provider: 'smtp' });
  assert.deepStrictEqual(mixed.errorMessages, ['Timed out', 'Quota exceeded']);
  assert.strictEqual(mixed.errors[0].category, 'timeout');
  assert.strictEqual(mixed.errors[1], error);
});

test('Attachment: leaving a Blob early cancels its reader', async () => {
  const blob = new Blob([new Uint8Array(70000).fill(65)]);
  let chunks = 0;
  for await (const chunk of iterateAttachmentContent(blob)) {
    assert.ok(chunk.length > 0);
    chunks++;
    break;
  }
  assert.strictEqual(chunks, 1);
  assert.strictEqual((await readAttachmentContent(blob)).length, 70000);
});

test('Attachment: content of the wrong type is rejected', async () => {
  await assert.rejects(readAttachmentContent(Promise.resolve('text')), {
    name: 'TypeError',
    message: 'Expected attachment bytes to be a Uint8Array.',
  });
  await assert.rejects(readAttachmentContent('text'), {
    name: 'TypeError',
    message: 'Expected replayable attachment content.',
  });
  const strings = async function* () {
    yield 'not bytes';
  };
  await assert.rejects(readAttachmentContent(strings), {
    name: 'TypeError',
    message: 'Expected an attachment chunk to be a Uint8Array.',
  });
});

test('Attachment: a source whose return() throws does not fail the reader that leaves', async () => {
  const factory = () => ({
    [Symbol.asyncIterator]() {
      return {
        next: () => Promise.resolve({ done: false, value: new Uint8Array([1]) }),
        return() {
          throw new Error('return failed');
        },
      };
    },
  });
  for await (const chunk of iterateAttachmentContent(factory)) {
    assert.deepStrictEqual([...chunk], [1]);
    break;
  }
});

const raw = (text, options = {}) => ({
  envelope: { from: 'alex@example.com', to: ['bob@example.com'] },
  content: new TextEncoder().encode(text),
  ...options,
});

test('Raw message: the encoding and the content are checked when planned', () => {
  assert.throws(() => createRawMessagePlan(raw('A: b\r\n\r\nx\r\n', { encoding: 'base64' })), {
    name: 'RawMessageValidationError',
    message: 'Invalid raw message encoding.',
  });
  const error = (() => {
    try {
      createRawMessagePlan({ ...raw(''), content: 'A: b\r\n' });
    } catch (caught) {
      return caught;
    }
  })();
  assert.ok(error instanceof RawMessageValidationError);
  assert.strictEqual(error.field, 'content');
});

test('Raw message: a source that grows between reads fails the read', async () => {
  let calls = 0;
  const growing = async function* () {
    calls++;
    yield new TextEncoder().encode(calls === 1 ? 'A: b\r\n\r\nx\r\n' : 'A: b\r\n\r\nxyz\r\n');
  };
  const plan = createRawMessagePlan({ ...raw(''), content: growing });
  const info = await analyzeRawMessage(plan);
  await assert.rejects(async () => {
    // oxlint-disable-next-line no-unused-vars -- the chunks are consumed, not read
    for await (const _ of iterateRawMessage(plan, { expectedSize: info.size })) {
      /* consume */
    }
  }, /size changed/);
});

test('Raw message: a long message yields to the event loop while it is read', async () => {
  const line = `${'a'.repeat(76)}\r\n`;
  const text = `A: b\r\n\r\n${line.repeat(16000)}`;
  const plan = createRawMessagePlan(raw(text));
  let size = 0;
  for await (const chunk of iterateRawMessage(plan)) size += chunk.length;
  assert.strictEqual(size, text.length);
});
