// Not ported: tests of ./postmark, ported from unemail's and sently's Postmark
// drivers, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');
const { createMessage } = require('../../index.js');
const { PostmarkTransport } = require('../../src/postmark/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const transport = (config = {}) =>
  new PostmarkTransport({ serverToken: 'server-token', retries: 0, ...config });
const message = (fields = {}) =>
  createMessage({
    from: { name: 'Shop, Inc.', address: 'shop@example.com' },
    to: ['bob@example.com', { name: 'Carol', address: 'carol@bücher.de' }],
    subject: 'Your order',
    content: { text: 'Shipped', html: '<p>Shipped</p>' },
    ...fields,
  });
const ok = (id = 'pm-1') => json({ ErrorCode: 0, Message: 'OK', MessageID: id });

test('Postmark: a message is the request of /email, with the token and no redirect', async (t) => {
  const requests = stubFetch(t, () => ok());
  const receipt = await transport({ messageStream: 'outbound', openTracking: true }).send(
    message({
      cc: 'dave@example.com',
      bcc: 'erin@example.com',
      replyTo: 'support@example.com',
      priority: 'high',
      tags: ['orders'],
      metadata: { orderId: '42' },
      tracking: { clicks: true },
      list: { unsubscribe: 'https://example.com/u', oneClick: true },
      attachments: [
        {
          filename: 'r.txt',
          contentType: 'text/plain',
          inline: false,
          contentId: '',
          content: new TextEncoder().encode('hi'),
        },
        {
          filename: 'logo.png',
          contentType: 'image/png',
          inline: true,
          contentId: 'logo@example.com',
          content: new Uint8Array([1, 2]),
        },
      ],
    }),
  );
  assert.deepStrictEqual(receipt, { successful: true, messageId: 'pm-1', provider: 'postmark' });
  const [request] = requests;
  assert.strictEqual(request.url, 'https://api.postmarkapp.com/email');
  assert.strictEqual(request.method, 'POST');
  assert.strictEqual(request.redirect, 'manual');
  assert.strictEqual(request.headers.get('x-postmark-server-token'), 'server-token');
  assert.strictEqual(request.headers.get('accept'), 'application/json');
  const body = request.json;
  assert.strictEqual(body.From, '"Shop, Inc." <shop@example.com>');
  assert.strictEqual(body.To, 'bob@example.com, Carol <carol@xn--bcher-kva.de>');
  assert.strictEqual(body.Cc, 'dave@example.com');
  assert.strictEqual(body.Bcc, 'erin@example.com');
  assert.strictEqual(body.ReplyTo, 'support@example.com');
  assert.strictEqual(body.TextBody, 'Shipped');
  assert.strictEqual(body.HtmlBody, '<p>Shipped</p>');
  assert.strictEqual(body.Tag, 'orders');
  assert.deepStrictEqual(body.Metadata, { orderId: '42' });
  assert.strictEqual(body.TrackOpens, true);
  assert.strictEqual(body.TrackLinks, 'HtmlAndText');
  assert.strictEqual(body.MessageStream, 'outbound');
  const headers = Object.fromEntries(body.Headers.map((header) => [header.Name, header.Value]));
  assert.strictEqual(headers['X-Priority'], '1');
  assert.strictEqual(headers['List-Unsubscribe'], '<https://example.com/u>');
  assert.strictEqual(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.deepStrictEqual(body.Attachments, [
    { Name: 'r.txt', Content: 'aGk=', ContentType: 'text/plain' },
    // sently sent the Content-ID without `cid:`, which Postmark needs.
    {
      Name: 'logo.png',
      Content: 'AQI=',
      ContentType: 'image/png',
      ContentID: 'cid:logo@example.com',
    },
  ]);
});

test('Postmark: a text-only message, a calendar, and tracking turned off', async (t) => {
  const requests = stubFetch(t, () => ok());
  await transport({ clickTracking: true }).send(
    createMessage({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Meeting',
      content: { text: 'See you' },
      tracking: { clicks: false },
      calendar: {
        content:
          'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//t//EN\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTAMP:20261017T000000Z\r\nDTSTART:20261018T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
      },
    }),
  );
  const body = requests[0].json;
  assert.strictEqual(body.TextBody, 'See you');
  assert.strictEqual(body.HtmlBody, undefined);
  assert.strictEqual(body.TrackLinks, 'None');
  assert.strictEqual(body.Attachments[0].Name, 'invite.ics');
  assert.strictEqual(body.Headers, undefined);
});

test('Postmark: an ErrorCode says what failed', async (t) => {
  const answers = [
    json(
      {
        ErrorCode: 406,
        Message: 'You tried to send to recipient(s) that have been marked as inactive.',
      },
      422,
    ),
    json({ ErrorCode: 300, Message: 'Invalid email request' }, 422),
    json({ ErrorCode: 10, Message: 'No Account or Server API tokens were supplied' }, 401),
    json({ ErrorCode: 401, Message: 'Sender signature not confirmed' }, 422),
  ];
  stubFetch(t, () => answers.shift());
  const inactive = await transport().send(message());
  assert.strictEqual(inactive.errors[0].category, 'rejected');
  assert.strictEqual(inactive.errors[0].code, 'postmark.406');
  assert.strictEqual(inactive.retryable, false);
  assert.match(inactive.errorMessages[0], /^Postmark: You tried to send/);
  assert.strictEqual((await transport().send(message())).errors[0].category, 'validation');
  assert.strictEqual((await transport().send(message())).errors[0].category, 'auth');
  assert.strictEqual((await transport().send(message())).errors[0].category, 'configuration');
});

test('Postmark: a server error is retried, a broken 2xx is of unknown delivery', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const answers = [
    json({ Message: 'oops' }, 503),
    ok('pm-2'),
    new Response('<html>', { status: 200 }),
  ];
  const requests = stubFetch(t, () => answers.shift());
  const retried = await transport({ retries: 1 }).send(message());
  assert.strictEqual(retried.messageId, 'pm-2');
  assert.strictEqual(requests.length, 2);
  const broken = await transport().send(message());
  assert.strictEqual(broken.successful, false);
  assert.strictEqual(broken.deliveryUnknown, true);
  assert.strictEqual(broken.retryable, false);
});

test('Postmark: a batch goes to /email/batch, each message with its own answer', async (t) => {
  const requests = stubFetch(t, (request) =>
    json(
      request.json.map((payload, index) =>
        index === 1
          ? { ErrorCode: 406, Message: 'Inactive recipient', To: payload.To }
          : { ErrorCode: 0, Message: 'OK', MessageID: `pm-${index}` },
      ),
    ),
  );
  const receipts = [];
  for await (const receipt of transport().sendMany([
    message(),
    message({ tags: ['a', 'b'] }),
    message(),
    message(),
  ])) {
    receipts.push(receipt);
  }
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful),
    [true, false, false, true],
  );
  assert.strictEqual(receipts[0].messageId, 'pm-0');
  assert.match(receipts[1].errorMessages[0], /one tag per message/);
  assert.strictEqual(receipts[2].errors[0].category, 'rejected');
  assert.strictEqual(receipts[3].messageId, 'pm-2');
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://api.postmarkapp.com/email/batch');
  assert.strictEqual(requests[0].json.length, 3);
});

test('Postmark: 500 a batch, a failed request fails its batch, a missing answer is unknown', async (t) => {
  let calls = 0;
  const requests = stubFetch(t, (request) => {
    calls++;
    if (calls === 2) return json({ Message: 'Too many batch messages', ErrorCode: 410 }, 422);
    return json(request.json.slice(1).map(() => ({ ErrorCode: 0, MessageID: 'x' })));
  });
  const messages = [];
  for (let i = 0; i < 502; i++) messages.push(message());
  const receipts = [];
  for await (const receipt of transport().sendMany(messages)) receipts.push(receipt);
  assert.deepStrictEqual(
    requests.map((request) => request.json.length),
    [500, 2],
  );
  // The first answer leaves out one message: unknown, not failed for sure.
  assert.strictEqual(receipts[499].deliveryUnknown, true);
  assert.strictEqual(receipts[500].successful, false);
  assert.strictEqual(receipts[500].errors[0].code, 'postmark.410');
  for await (const receipt of transport().sendMany([message({ tags: ['a', 'b'] })])) {
    assert.match(receipt.errorMessages[0], /one tag/);
  }
  assert.strictEqual(requests.length, 2);
});

test('Postmark: a scheduled message and two tags are refused before any request', async (t) => {
  const requests = stubFetch(t, () => ok());
  const scheduled = await transport().send(message({ scheduledAt: new Date() }));
  assert.match(scheduled.errorMessages[0], /Invalid scheduledAt: postmark/);
  const tagged = await transport().send(message({ tags: ['a', 'b'] }));
  assert.match(tagged.errorMessages[0], /one tag per message/);
  assert.strictEqual(requests.length, 0);
});

test('Postmark: verify reads the server of the token', async (t) => {
  const answers = [
    json({ ID: 1, Name: 'Server' }),
    json({ ErrorCode: 10, Message: 'Bad token' }, 401),
  ];
  const requests = stubFetch(t, () => answers.shift());
  await transport().verify();
  assert.strictEqual(requests[0].url, 'https://api.postmarkapp.com/server');
  assert.strictEqual(requests[0].method, 'GET');
  await assert.rejects(transport().verify(), /Postmark refused the credentials/);
});

test('Postmark: the options are checked, and the token never shows', () => {
  assert.throws(() => new PostmarkTransport({}), /needs serverToken/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), /HTTPS/);
  assert.throws(() => transport({ messageStream: '' }), /messageStream must be a non-empty string/);
  assert.throws(() => transport({ openTracking: 'yes' }), /openTracking must be a boolean/);
  assert.throws(() => transport({ timeout: -1 }), /timeout/);
  const made = transport();
  assert.strictEqual(made.id, 'postmark');
  assert.ok(!JSON.stringify(made).includes('server-token'));
  assert.ok(!util.inspect(made, { depth: 5 }).includes('server-token'));
});

test('Postmark: an abort rejects with its reason', async (t) => {
  stubFetch(t, () => ok());
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(transport().send(message(), { signal: controller.signal }), /stop/);
  await assert.rejects(transport().verify({ signal: controller.signal }), /stop/);
  const sending = transport().sendMany([message()], { signal: controller.signal });
  await assert.rejects(sending.next(), /stop/);
});
