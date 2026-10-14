// Ported from upyo v0.7.0 (packages/mime/src/cancellation.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessage } = require('../../src/core/message.js');
const { readAttachmentContent } = require('../../src/core/attachment.js');
const { composeMessage } = require('../../src/mime/index.js');
const { TEST_DKIM_PRIVATE_KEY } = require('../helpers/mime/dkim-test-keys.js');

const message = (content) =>
  createMessage({
    from: 'from@example.com',
    to: 'to@example.com',
    subject: 'Test',
    content: { text: 'x'.repeat(200000) },
    attachments:
      content == null
        ? []
        : [
            {
              filename: 'a',
              contentType: 'application/octet-stream',
              contentId: 'a',
              inline: false,
              content,
            },
          ],
  });
const dkim = {
  signatures: [
    {
      signingDomain: 'example.com',
      selector: 'test',
      privateKey: TEST_DKIM_PRIVATE_KEY,
    },
  ],
};

for (const signing of [false, true]) {
  test(`abort before and after headers, signed=${signing}`, async () => {
    const lifetime = new AbortController();
    const reason = new TypeError('Stopped.');
    const raw = await composeMessage(message(), {
      signal: lifetime.signal,
      dkim: signing ? dkim : undefined,
    });
    const iterator = raw.content()[Symbol.asyncIterator]();
    assert.ok(!(await iterator.next()).done);
    lifetime.abort(reason);
    await assert.rejects(iterator.next(), (error) => error === reason);
    await assert.rejects(readAttachmentContent(raw.content), (error) => error === reason);
    await assert.rejects(
      composeMessage(message(), { signal: lifetime.signal }),
      (error) => error === reason,
    );
  });
}

test('reader cancellation leaves another reader usable', async () => {
  const raw = await composeMessage(message());
  const controller = new AbortController();
  const iterator = raw.content(controller.signal)[Symbol.asyncIterator]();
  await iterator.next();
  controller.abort();
  await assert.rejects(iterator.next(), { name: 'AbortError' });
  assert.ok((await readAttachmentContent(raw.content)).length > 200000);
});

for (const exit of ['break', 'throw', 'source-error', 'abort']) {
  test(`attachment cleanup after ${exit}`, async () => {
    let returns = 0;
    let sourceSignal;
    let resolveOpened;
    const opened = new Promise((resolve) => {
      resolveOpened = resolve;
    });
    const error = new TypeError('Stopped.');
    let pulls = 0;
    const raw = await composeMessage(
      message((signal) => {
        sourceSignal = signal;
        resolveOpened();
        const iterator = {
          [Symbol.asyncIterator]() {
            return this;
          },
          next() {
            pulls++;
            if (pulls === 1) {
              return Promise.resolve({
                done: false,
                value: new Uint8Array([1, 2, 3]),
              });
            }
            if (exit === 'source-error') return Promise.reject(error);
            return new Promise(() => {});
          },
          return() {
            returns++;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
        return iterator;
      }),
    );
    assert.equal(pulls, 0);
    const controller = new AbortController();
    const consuming = (async () => {
      // oxlint-disable-next-line no-underscore-dangle, no-unused-vars -- upstream
      for await (const _chunk of raw.content(controller.signal)) {
        if (pulls > 0 && exit === 'break') break;
        if (pulls > 0 && exit === 'throw') throw error;
      }
    })();
    await opened;
    if (exit === 'abort') controller.abort(error);
    if (exit === 'break') await consuming;
    else await assert.rejects(consuming, (actual) => actual === error);
    assert.equal(returns, 1);
    assert.ok(sourceSignal?.aborted);
    assert.ok(pulls <= 2);
  });
}

for (const phase of ['unsigned', 'prehash', 'replay']) {
  test(`cancel pending acquisition in ${phase} and close late reader`, async () => {
    let acquired;
    let opened;
    const opening = new Promise((resolve) => {
      opened = resolve;
    });
    let calls = 0;
    let returns = 0;
    const controller = new AbortController();
    const reason = new TypeError('Cancelled.');
    const content = () => {
      if (phase === 'replay' && calls++ === 0) {
        return (async function* () {
          yield new Uint8Array([1]);
        })();
      }
      opened();
      return new Promise((resolve) => {
        acquired = resolve;
      });
    };
    const composition = composeMessage(message(content), {
      signal: controller.signal,
      dkim: phase === 'unsigned' ? undefined : { ...dkim, bodyMode: 'streaming' },
    });
    const work =
      phase === 'prehash'
        ? composition
        : composition.then((raw) => readAttachmentContent(raw.content));
    await opening;
    controller.abort(reason);
    await assert.rejects(work, (actual) => actual === reason);
    acquired({
      [Symbol.asyncIterator]() {
        return {
          next: () => Promise.resolve({ done: true, value: undefined }),
          return: () => {
            returns++;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(returns, 1);
  });
}
