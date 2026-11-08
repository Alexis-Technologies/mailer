// Not ported: tests of ./viber against a stubbed fetch: the request of
// send_message, its keyboard and picture, the status of a 200, the token of
// a message read from the text of the answer, and what Viber would refuse.
// The answers are those of the examples of Viber's documentation.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { ViberTransport } = require('../../src/viber/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const USER = '01234567890A=';
const TOKEN = '445da6az1s345z78-dazcczb2542zv51a-e0vc5fva17480im9';
const transport = (config = {}) =>
  new ViberTransport({ authToken: TOKEN, sender: { name: 'Shop' }, retries: 0, ...config });
const viber = (fields = {}) =>
  createChannelMessage({ channel: 'viber', to: USER, text: 'Your order shipped', ...fields });
// The token of the examples, past what a number of JavaScript holds.
const sent = () =>
  new Response(
    '{"status":0,"status_message":"ok","message_token":5741311803571721087,"chat_hostname":"SN-CHAT-05_"}',
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
const refused = (status, message) => json({ status, status_message: message });

test('Viber: a text is send_message from the sender, with the token of the bot', async (t) => {
  const requests = stubFetch(t, () => sent());
  const receipt = await transport().send(viber({ metadata: { correlationId: 'order-42' } }));
  const [request] = requests;
  assert.strictEqual(request.url, 'https://chatapi.viber.com/pa/send_message');
  assert.strictEqual(request.method, 'POST');
  assert.strictEqual(request.headers.get('x-viber-auth-token'), TOKEN);
  assert.deepStrictEqual(request.json, {
    receiver: USER,
    sender: { name: 'Shop' },
    type: 'text',
    text: 'Your order shipped',
    tracking_data: 'order-42',
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: '5741311803571721087',
    provider: 'viber',
    channel: 'viber',
    state: 'accepted',
  });
});

test('Viber: the token of a message keeps every digit', async (t) => {
  // Before (VB2): viber-bot parsed the answer as JSON, so 5741311803571721087
  // became 5741311803571721000 and no delivery callback matched it.
  stubFetch(t, () => sent());
  const receipt = await transport().send(viber());
  assert.strictEqual(receipt.messageId, '5741311803571721087');
  assert.notStrictEqual(String(JSON.parse('5741311803571721087')), receipt.messageId);
});

test('Viber: a picture, a keyboard, the sender and the payload of a message', async (t) => {
  const requests = stubFetch(t, () => sent());
  await transport({ sender: { name: 'Shop', avatar: 'https://example.com/a.png' } }).send(
    viber({
      from: 'Shop support',
      media: [{ url: 'https://example.com/parcel.jpg', contentType: 'image/jpeg' }],
      buttons: [
        { type: 'url', text: 'Track', url: 'https://example.com/track/1' },
        { type: 'reply', text: 'Thanks', id: 'thanks' },
      ],
      payload: { min_api_version: 7 },
    }),
  );
  assert.deepStrictEqual(requests[0].json, {
    receiver: USER,
    sender: { name: 'Shop support', avatar: 'https://example.com/a.png' },
    type: 'picture',
    text: 'Your order shipped',
    media: 'https://example.com/parcel.jpg',
    keyboard: {
      Type: 'keyboard',
      Buttons: [
        { ActionType: 'open-url', ActionBody: 'https://example.com/track/1', Text: 'Track' },
        { ActionType: 'reply', ActionBody: 'thanks', Text: 'Thanks' },
      ],
    },
    min_api_version: 7,
  });
  await transport().send(viber({ text: undefined, media: [{ url: 'https://example.com/p.png' }] }));
  assert.strictEqual(requests[1].json.text, '');
  await transport().send(
    viber({
      text: undefined,
      payload: { type: 'file', media: 'https://example.com/a.pdf', size: 1000, file_name: 'a.pdf' },
    }),
  );
  assert.strictEqual(requests[2].json.type, 'file');
});

test('Viber: the status of a 200 is the category of its failure', async (t) => {
  const cases = [
    [5, 'receiverNotRegistered', 'not-on-channel', false],
    [6, 'notSubscribed', 'not-on-channel', false],
    [11, 'receiverNoSuitableDevice', 'not-on-channel', false],
    [2, 'invalidAuthToken', 'auth', false],
    [12, 'tooManyRequests', 'rate-limit', true],
    [3, 'badData', 'validation', false],
    [7, 'publicAccountBlocked', 'configuration', false],
    [24, 'noBalance', 'configuration', false],
    [99, 'generalError', 'rejected', false],
  ];
  for (const [status, message, category, retryable] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => refused(status, message));
    const receipt = await transport().send(viber());
    assert.strictEqual(receipt.errors[0].category, category, message);
    assert.strictEqual(receipt.retryable, retryable, message);
    assert.strictEqual(receipt.errors[0].code, `viber.${status}`, message);
    assert.match(receipt.errorMessages[0], new RegExp(`Viber: ${message}`));
    assert.strictEqual(receipt.channel, 'viber');
  }
});

test('Viber: no token is of unknown delivery, and a lost answer is not sent again', async (t) => {
  stubFetch(t, () => json({ status: 0, status_message: 'ok' }));
  assert.strictEqual((await transport().send(viber())).deliveryUnknown, true);
  t.mock.restoreAll();
  stubFetch(t, () => new Response('<html>proxy</html>', { status: 200 }));
  assert.strictEqual((await transport().send(viber())).deliveryUnknown, true);
  t.mock.restoreAll();
  const requests = stubFetch(t, () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    });
  });
  assert.strictEqual((await transport({ retries: 3 }).send(viber())).deliveryUnknown, true);
  assert.strictEqual(requests.length, 1);
});

test('Viber: what a message of Viber cannot be fails before any request', async (t) => {
  const requests = stubFetch(t, () => sent());
  const cases = [
    [viber({ text: 'x'.repeat(7001) }), 'validation', /more than 7000/],
    [
      viber({ text: 'x'.repeat(769), media: [{ url: 'https://example.com/a.png' }] }),
      'validation',
      /picture is more than 768/,
    ],
    [viber({ from: 'x'.repeat(29) }), 'validation', /sender is more than 28/],
    [
      viber({ media: [{ url: 'https://example.com/a.mp4', contentType: 'video/mp4' }] }),
      'unsupported',
      /picture at its URL/,
    ],
    [
      viber({
        media: [{ url: 'https://example.com/a.png' }, { url: 'https://example.com/b.png' }],
      }),
      'unsupported',
      /one picture/,
    ],
    [
      viber({ buttons: [{ type: 'call', text: 'Call', phone: '+380441234567' }] }),
      'unsupported',
      /opens a link or replies/,
    ],
    [viber({ payload: { receiver: 'other' } }), 'validation', /cannot set receiver/],
    [viber({ text: undefined, payload: { tag: 'x' } }), 'validation', /needs a text/],
    [
      createChannelMessage({ channel: 'telegram', to: '12345', text: 'x' }),
      'unsupported',
      /not of telegram/,
    ],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport().send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.strictEqual(requests.length, 0);
});

test('Viber: the options are checked when made, the token never shown', () => {
  assert.throws(() => new ViberTransport({ authToken: TOKEN }), /needs sender.name/);
  assert.throws(() => transport({ sender: { name: 'x'.repeat(29) } }), /28 characters/);
  assert.throws(
    () => transport({ sender: { name: 'S', avatar: 'http://x.example/a' } }),
    TypeError,
  );
  assert.throws(() => new ViberTransport({ sender: { name: 'S' } }), /needs authToken/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), TypeError);
  assert.ok(!JSON.stringify(transport()).includes(TOKEN));
});

test('Viber: verify reads the account, whose refusal is a status in a 200', async (t) => {
  const requests = stubFetch(t, () => json({ status: 0, status_message: 'ok', id: 'pa:1' }));
  await transport().verify();
  assert.strictEqual(requests[0].url, 'https://chatapi.viber.com/pa/get_account_info');
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].headers.get('x-viber-auth-token'), TOKEN);
  t.mock.restoreAll();
  // Before (C38): the refusal, in a 200, was retried as a read, four
  // requests over seconds, and its statusCode was Viber's status.
  const refusals = stubFetch(t, () => refused(2, 'invalidAuthToken'));
  await assert.rejects(
    transport({ retries: 3 }).verify(),
    (error) =>
      /Viber refused the token: invalidAuthToken/.test(error.message) &&
      error.statusCode === 200 &&
      error.code === 'viber.2',
  );
  assert.strictEqual(refusals.length, 1);
});
