// Not ported: a transport for the tests of the decorators, which answers each
// message with the receipt `answer(message, index)` gives, or throws what it
// returns as `{ throw }`.

const sent = (messageId) => ({ successful: true, messageId, provider: 'fake' });

const failed = (category, extra = {}) => ({
  successful: false,
  errorMessages: [`${category} failure`],
  errors: [{ message: `${category} failure`, category, retryable: true, provider: 'fake' }],
  retryable: true,
  provider: 'fake',
  ...extra,
});

/**
 * A fake transport.  `calls` holds what each send was given; `sendMany`
 * reads its input `readAhead` messages ahead, as a batching transport does.
 */
const fakeTransport = (answer = (_message, index) => sent(`m${index}`), extras = {}) => {
  const calls = [];
  const respond = async (message, options, operation) => {
    const index = calls.length;
    calls.push({ message, options, operation });
    const result = await answer(message, index, options);
    if (result?.throw !== undefined) throw result.throw;
    return result;
  };
  const transport = {
    id: 'fake',
    calls,
    send: (message, options) => respond(message, options, 'send'),
    sendRaw: (message, options) => respond(message, options, 'sendRaw'),
    async *sendMany(messages, options) {
      const readAhead = extras.readAhead ?? 0;
      const buffer = [];
      for await (const message of messages) {
        buffer.push(message);
        if (buffer.length > readAhead) yield await respond(buffer.shift(), options, 'sendMany');
      }
      while (buffer.length > 0) yield await respond(buffer.shift(), options, 'sendMany');
    },
    verified: 0,
    async verify() {
      transport.verified++;
    },
    disposed: 0,
    async [Symbol.asyncDispose]() {
      transport.disposed++;
    },
    ...extras.overrides,
  };
  return transport;
};

const collect = async (iterable) => {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
};

module.exports = { collect, failed, fakeTransport, sent };
