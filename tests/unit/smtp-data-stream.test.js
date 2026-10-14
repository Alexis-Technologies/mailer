// Ported from upyo v0.7.0 (packages/smtp/src/data-stream.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Writable } = require('node:stream');
const { Buffer } = require('node:buffer');
const { writeMessageData } = require('../../src/smtp/data-stream.js');

test('does not pull another chunk until a blocked write drains', async () => {
  let finishWrite;
  const writes = [];
  const socket = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      const value = chunk.toString();
      writes.push(value);
      if (value === '.\r\n') {
        callback();
        queueMicrotask(() => socket.emit('data', Buffer.from('250 OK\r\n')));
      } else finishWrite = callback;
    },
  });
  let pulls = 0;
  const pending = writeMessageData(
    socket,
    async function* () {
      pulls++;
      yield Buffer.from('.first\r');
      pulls++;
      yield Buffer.from('\n.second\r\n');
    },
    1000,
    () => {},
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(pulls, 1);
  assert.equal(writes.length, 1);
  finishWrite();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(pulls, 2);
  finishWrite();
  assert.equal((await pending).code, 250);
  assert.equal(writes.join(''), '..first\r\n..second\r\n.\r\n');
  socket.destroy();
});

for (const failure of ['abort', 'timeout', 'early reply', 'close']) {
  test(`stops DATA on ${failure} while next is pending`, async () => {
    const socket = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const controller = new AbortController();
    let returns = 0;
    let owned;
    const pending = writeMessageData(
      socket,
      (signal) => {
        owned = signal;
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
      },
      30,
      () => {},
      controller.signal,
    );
    const rejected = assert.rejects(pending);
    if (failure === 'abort') controller.abort(new TypeError('Canceled.'));
    if (failure === 'early reply') {
      socket.emit('data', Buffer.from('250 early\r\n'));
    }
    if (failure === 'close') socket.destroy();
    await rejected;
    assert.ok(owned?.aborted);
    assert.ok(socket.destroyed);
    assert.equal(returns, 1);
  });
}
