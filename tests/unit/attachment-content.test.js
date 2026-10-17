// Ported from upyo v0.7.0 (packages/core/src/attachment-content.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { describe, it } = require('node:test');
const { iterateAttachmentContent, readAttachmentContent } = require('../../src/core/attachment.js');

describe('attachment content', () => {
  it('does not return bytes when cancellation wins before the await resumes', async () => {
    const controller = new AbortController();
    let finish;
    const input = new Promise((resolve) => (finish = resolve));
    const pending = readAttachmentContent(input, controller.signal);
    await Promise.resolve();
    finish(new Uint8Array([1]));
    queueMicrotask(() => controller.abort(new TypeError('Canceled.')));
    await assert.rejects(pending, (error) => error === controller.signal.reason);
  });
  it('copies reusable Buffer chunks rather than retaining their slice views', async () => {
    const bytes = Buffer.from([1]);
    const collected = await readAttachmentContent(async function* () {
      yield bytes;
      bytes[0] = 2;
      yield bytes;
    });
    assert.deepEqual(collected, new Uint8Array([1, 2]));
  });
  it('retains byte array identity and reads blobs', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    assert.equal(await readAttachmentContent(bytes), bytes);
    assert.equal(await readAttachmentContent(Promise.resolve(bytes)), bytes);
    assert.deepEqual(await readAttachmentContent(new Blob([bytes])), bytes);
  });

  it('reopens factories and copies chunks before the producer reuses them', async () => {
    let calls = 0;
    const source = async function* () {
      calls++;
      const buffer = new Uint8Array([1]);
      yield buffer;
      buffer[0] = 2;
      yield buffer;
    };
    assert.deepEqual(await readAttachmentContent(source), new Uint8Array([1, 2]));
    assert.deepEqual(await readAttachmentContent(source), new Uint8Array([1, 2]));
    assert.equal(calls, 2);
  });

  it('requests return immediately when an outstanding next is aborted', async () => {
    const controller = new AbortController();
    let returns = 0;
    let sourceSignal;
    const source = (signal) => {
      sourceSignal = signal;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise(() => {}),
            return: () => {
              returns++;
              return new Promise(() => {});
            },
          };
        },
      };
    };
    const pending = readAttachmentContent(source, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reason = new TypeError('Canceled.');
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
    assert.ok(sourceSignal?.aborted);
    assert.equal(returns, 1);
  });

  it('closes a late factory result without pulling it', async () => {
    const controller = new AbortController();
    let resolve;
    let returns = 0;
    const pending = readAttachmentContent(
      // oxlint-disable-next-line promise/param-names -- upstream: `resolve` is the outer binding
      () => new Promise((done) => (resolve = done)),
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    await assert.rejects(pending);
    resolve({
      [Symbol.asyncIterator]() {
        return {
          next() {
            assert.fail('A canceled factory must not be pulled.');
          },
          return() {
            returns++;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    });
    // oxlint-disable-next-line promise/param-names -- upstream: `resolve` is the outer binding
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(returns, 1);
  });

  it('aborts the source and closes it on early consumer exit', async () => {
    let closed = false;
    let sourceSignal;
    for await (const chunk of iterateAttachmentContent(async function* (signal) {
      sourceSignal = signal;
      try {
        yield new Uint8Array([1]);
        assert.fail('Unexpected read ahead.');
      } finally {
        closed = true;
      }
    })) {
      assert.equal(chunk[0], 1);
      break;
    }
    assert.ok(closed);
    assert.ok(sourceSignal?.aborted);
  });

  it('allows timers to cancel an endless stream of empty chunks', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10);
    try {
      await assert.rejects(
        readAttachmentContent(async function* () {
          while (true) yield new Uint8Array();
        }, controller.signal),
      );
    } finally {
      clearTimeout(timer);
    }
  });
});
