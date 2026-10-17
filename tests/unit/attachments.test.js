// Not ported: the helpers of ./attachments, after nodemailer's `path`, `href`
// and data URIs and sently's `resolveAttachments`.  Files are made in a
// temporary directory, URLs answered by a local server.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const PostalMime = require('postal-mime');
const { createMessage, readAttachmentContent } = require('../../index.js');
const {
  fromDataUri,
  fromPath,
  fromStream,
  fromUrl,
  inlineDataUrls,
  isPublicUrl,
} = require('../../src/attachments/index.js');
const { composeMessage } = require('../../src/mime/index.js');

const bytesOf = (text) => new TextEncoder().encode(text);
const textOf = async (attachment) =>
  new TextDecoder().decode(await readAttachmentContent(attachment.content));

const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-attachments-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('Attachments: fromPath reads the file at each reading, named by its path', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'Report October.pdf');
  fs.writeFileSync(file, 'first');
  const attachment = await fromPath(file);
  assert.strictEqual(attachment.filename, 'Report October.pdf');
  assert.strictEqual(attachment.contentType, 'application/pdf');
  assert.strictEqual(attachment.inline, false);
  assert.strictEqual(attachment.contentId, '');
  assert.strictEqual(typeof attachment.content, 'function');
  assert.strictEqual(await textOf(attachment), 'first');
  // Read again for a retry or a DKIM pass: what is on disk now.
  fs.writeFileSync(file, 'second');
  assert.strictEqual(await textOf(attachment), 'second');
  const named = await fromPath(file, {
    filename: 'r.txt',
    contentId: 'r@example.com',
    inline: true,
  });
  assert.strictEqual(named.contentType, 'text/plain');
  assert.strictEqual(named.inline, true);
  const unknown = path.join(dir, 'data.unknown');
  fs.writeFileSync(unknown, 'x');
  assert.strictEqual((await fromPath(unknown)).contentType, 'application/octet-stream');
});

test('Attachments: fromPath keeps a file within root, a symbolic link too', async (t) => {
  const dir = tempDir(t);
  const root = path.join(dir, 'files');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'ok.txt'), 'ok');
  fs.writeFileSync(path.join(root, '..notes.txt'), 'ok');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret');
  assert.strictEqual(await textOf(await fromPath(path.join(root, 'ok.txt'), { root })), 'ok');
  assert.strictEqual(
    (await fromPath(path.join(root, '..notes.txt'), { root })).filename,
    '..notes.txt',
  );
  await assert.rejects(fromPath(path.join(root, '../secret.txt'), { root }), RangeError);
  // sently compared the paths as written, so a link inside the root that
  // points out of it passed.
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(dir, 'secret.txt'), path.join(root, 'link.txt'));
    await assert.rejects(fromPath(path.join(root, 'link.txt'), { root }), /is outside/);
  }
  await assert.rejects(fromPath(root), /is not a file/);
  await assert.rejects(fromPath(path.join(root, 'missing.txt')), { code: 'ENOENT' });
  await assert.rejects(fromPath(''), TypeError);
  await assert.rejects(
    fromPath(path.join(root, 'ok.txt'), { inline: true }),
    /needs the contentId/,
  );
});

test('Attachments: fromPath stops reading on abort', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'big.bin');
  fs.writeFileSync(file, Buffer.alloc(1024 * 1024));
  const attachment = await fromPath(file);
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(readAttachmentContent(attachment.content, controller.signal));
});

// A local server: each path answers as its handler says.
const serve = async (t, handlers) => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers });
    const handler = handlers[request.url.split('?')[0]];
    if (handler === undefined) {
      response.writeHead(404).end();
      return;
    }
    handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}`, requests };
};
const anyUrl = () => true;

test('Attachments: fromUrl fetches once, named by the path and typed by the server', async (t) => {
  const { base, requests } = await serve(t, {
    '/files/logo.png': (request, response) => {
      response.writeHead(200, { 'content-type': 'image/png; charset=binary' });
      response.end('PNG');
    },
    '/download': (request, response) => {
      response.writeHead(200, { 'content-type': 'application/pdf' });
      response.end('PDF');
    },
    '/files/r%C3%A9sum%C3%A9.txt': (request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end('cv');
    },
  });
  const logo = await fromUrl(`${base}/files/logo.png?v=2`, { allowUrl: anyUrl });
  assert.strictEqual(logo.filename, 'logo.png');
  assert.strictEqual(logo.contentType, 'image/png');
  assert.ok(logo.content instanceof Uint8Array);
  assert.strictEqual(await textOf(logo), 'PNG');
  await textOf(logo);
  assert.strictEqual(requests.length, 1);
  const pdf = await fromUrl(new URL(`${base}/download`), { allowUrl: anyUrl });
  assert.strictEqual(pdf.filename, 'download.pdf');
  // application/octet-stream says less than the extension.
  const cv = await fromUrl(`${base}/files/r%C3%A9sum%C3%A9.txt`, { allowUrl: anyUrl });
  assert.strictEqual(cv.filename, 'résumé.txt');
  assert.strictEqual(cv.contentType, 'text/plain');
});

test('Attachments: fromUrl checks each redirect and sends headers to the origin only', async (t) => {
  const other = await serve(t, {
    '/a.txt': (request, response) => response.writeHead(200).end('moved'),
  });
  const { base, requests } = await serve(t, {
    '/start': (request, response) => response.writeHead(302, { location: '/next' }).end(),
    '/next': (request, response) =>
      response.writeHead(301, { location: `${other.base}/a.txt` }).end(),
    '/loop': (request, response) => response.writeHead(307, { location: '/loop' }).end(),
    '/nowhere': (request, response) => response.writeHead(302).end(),
    '/ftp': (request, response) =>
      response.writeHead(302, { location: 'ftp://example.com/a' }).end(),
  });
  const seen = [];
  const attachment = await fromUrl(`${base}/start`, {
    headers: { authorization: 'Bearer secret' },
    allowUrl: (url) => {
      seen.push(url.href);
      return true;
    },
  });
  assert.strictEqual(await textOf(attachment), 'moved');
  assert.deepStrictEqual(seen, [`${base}/start`, `${base}/next`, `${other.base}/a.txt`]);
  assert.strictEqual(requests[0].headers.authorization, 'Bearer secret');
  assert.strictEqual(other.requests[0].headers.authorization, undefined);
  await assert.rejects(
    fromUrl(`${base}/start`, { allowUrl: (url) => url.origin === base }),
    /not allowed/,
  );
  await assert.rejects(fromUrl(`${base}/loop`, { allowUrl: anyUrl }), /More than 5 redirects/);
  await assert.rejects(
    fromUrl(`${base}/start`, { allowUrl: anyUrl, maxRedirects: 1 }),
    /More than 1 redirects/,
  );
  await assert.rejects(fromUrl(`${base}/nowhere`, { allowUrl: anyUrl }), /without a Location/);
  await assert.rejects(fromUrl(`${base}/ftp`, { allowUrl: anyUrl }), /must be http or https/);
});

test('Attachments: fromUrl bounds the bytes and the time, and fails on an error status', async (t) => {
  const { base } = await serve(t, {
    '/big': (request, response) => {
      response.writeHead(200, { 'content-length': '2048' });
      response.end(Buffer.alloc(2048));
    },
    '/chunked': (request, response) => {
      response.writeHead(200);
      response.write(Buffer.alloc(600));
      response.end(Buffer.alloc(600));
    },
    '/slow': (request, response) => {
      response.writeHead(200);
      response.write('a');
    },
    '/gone': (request, response) => response.writeHead(410).end(),
  });
  const options = { allowUrl: anyUrl, maxBytes: 1024 };
  await assert.rejects(fromUrl(`${base}/big`, options), /exceeds 1024 bytes/);
  await assert.rejects(fromUrl(`${base}/chunked`, options), /exceeds 1024 bytes/);
  await assert.rejects(fromUrl(`${base}/slow`, { allowUrl: anyUrl, timeout: 50 }), {
    name: 'TimeoutError',
  });
  await assert.rejects(fromUrl(`${base}/gone`, { allowUrl: anyUrl }), /HTTP 410/);
  const controller = new AbortController();
  controller.abort(new Error('stopped'));
  await assert.rejects(
    fromUrl(`${base}/big`, { allowUrl: anyUrl, signal: controller.signal }),
    /stopped/,
  );
});

test('Attachments: fromUrl refuses local addresses by default, and takes an injected fetch', async () => {
  const refused = [
    'http://localhost/a',
    'http://app.localhost/a',
    'http://127.0.0.1/a',
    'http://2130706433/a',
    'http://0x7f.1/a',
    'http://10.0.0.1/a',
    'http://172.16.5.4/a',
    'http://192.168.1.1/a',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/a',
    'http://0.0.0.0/a',
    'http://[::1]/a',
    'http://[fd00::1]/a',
    'http://[fe80::1]/a',
    'http://[::ffff:127.0.0.1]/a',
  ];
  for (const url of refused) {
    assert.strictEqual(isPublicUrl(new URL(url)), false, url);
    await assert.rejects(fromUrl(url), /not allowed/, url);
  }
  for (const url of ['https://example.com/a', 'http://93.184.216.34/a', 'http://[2606:4700::1]/']) {
    assert.strictEqual(isPublicUrl(new URL(url)), true, url);
  }
  await assert.rejects(fromUrl('file:///etc/passwd'), /must be http or https/);
  await assert.rejects(fromUrl('not a url'), /Invalid attachment URL/);
  const calls = [];
  const attachment = await fromUrl('https://cdn.example.com/a.css', {
    fetch: async (url, init) => {
      calls.push({ url: url.href, redirect: init.redirect });
      return new Response('body{}', { headers: { 'content-type': 'text/css' } });
    },
  });
  assert.deepStrictEqual(calls, [{ url: 'https://cdn.example.com/a.css', redirect: 'manual' }]);
  assert.strictEqual(attachment.contentType, 'text/css');
  // A segment that does not decode keeps its percent-encoding.
  const raw = await fromUrl('https://cdn.example.com/a%E0.txt', {
    fetch: async () => new Response('x'),
  });
  assert.strictEqual(raw.filename, 'a%E0.txt');
  await assert.rejects(fromUrl('https://example.com', { maxBytes: 0 }), /maxBytes/);
  await assert.rejects(fromUrl('https://example.com', { timeout: -1 }), /timeout/);
  await assert.rejects(fromUrl('https://example.com', { maxRedirects: 1.5 }), /maxRedirects/);
});

test('Attachments: isPublicUrl refuses the ranges that reach a local address or are not unicast', () => {
  // Each of these reached the machine, or a network next to it, and was allowed.
  const refused = [
    // ::/96, the IPv4-compatible form (it holds :: and ::1 too).
    'http://[::127.0.0.1]/a',
    'http://[::10.0.0.1]/a',
    'http://[::a9fe:a9fe]/a',
    // NAT64, 64:ff9b::/96 and 64:ff9b:1::/48: the whole prefix, whatever it embeds.
    'http://[64:ff9b::7f00:1]/a',
    'http://[64:ff9b::808:808]/a',
    'http://[64:ff9b:1::1]/a',
    'http://[64:ff9b:1:ffff::1]/a',
    // 6to4, 2002::/16.
    'http://[2002:7f00:1::]/a',
    'http://[2002:a9fe:a9fe::1]/a',
    'http://[2002:5db8:d822::1]/a',
    // Site-local, fec0::/10, and multicast, ff00::/8.
    'http://[fec0::1]/a',
    'http://[feff::1]/a',
    'http://[ff02::1]/a',
    'http://[ff0e::1]/a',
    // IETF protocol assignments, multicast, reserved, broadcast.
    'http://192.0.0.1/a',
    'http://192.0.0.255/a',
    'http://224.0.0.1/a',
    'http://239.255.255.255/a',
    'http://240.0.0.1/a',
    'http://255.255.255.254/a',
    'http://255.255.255.255/a',
    // The documentation ranges.
    'http://192.0.2.1/a',
    'http://198.51.100.7/a',
    'http://203.0.113.9/a',
  ];
  for (const url of refused) assert.strictEqual(isPublicUrl(new URL(url)), false, url);
  // The edges of the new ranges stay public.
  const allowed = [
    'http://192.0.1.1/a',
    'http://192.0.3.1/a',
    'http://223.255.255.255/a',
    'http://198.51.99.1/a',
    'http://198.51.101.1/a',
    'http://203.0.112.1/a',
    'http://203.0.114.1/a',
    'http://[::1:0:0]/a',
    'http://[64:ff9a::1]/a',
    'http://[64:ff9c::1]/a',
    'http://[2003::1]/a',
    'http://[2606:4700:4700::1111]/a',
  ];
  for (const url of allowed) assert.strictEqual(isPublicUrl(new URL(url)), true, url);
});

test('Attachments: fromUrl refuses a redirect from https to http, and no other change of scheme', async () => {
  const calls = [];
  const redirecting = (to) => async (url) => {
    calls.push(url.href);
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: to } });
    return new Response('body', { headers: { 'content-type': 'text/plain' } });
  };
  // The downgrade is refused before the second request, so nothing is sent in clear.
  calls.length = 0;
  await assert.rejects(
    fromUrl('https://cdn.example.com/a.txt', {
      fetch: redirecting('http://cdn.example.com/b.txt'),
      headers: { authorization: 'Bearer secret' },
    }),
    /not allowed.*downgrade/s,
  );
  assert.deepStrictEqual(calls, ['https://cdn.example.com/a.txt']);
  // It is refused even when allowUrl allows everything, and when the host is another one.
  calls.length = 0;
  await assert.rejects(
    fromUrl('https://cdn.example.com/a.txt', {
      fetch: redirecting('http://other.example.org/b.txt'),
      allowUrl: anyUrl,
    }),
    /downgrade/,
  );
  assert.strictEqual(calls.length, 1);
  // A relative Location keeps the scheme; an upgrade and http to http are allowed.
  for (const [from, to] of [
    ['https://cdn.example.com/a.txt', '/b.txt'],
    ['https://cdn.example.com/a.txt', 'https://other.example.org/b.txt'],
    ['http://cdn.example.com/a.txt', 'https://cdn.example.com/b.txt'],
    ['http://cdn.example.com/a.txt', 'http://cdn.example.com/b.txt'],
  ]) {
    calls.length = 0;
    const attachment = await fromUrl(from, { fetch: redirecting(to) });
    assert.strictEqual(await textOf(attachment), 'body', `${from} to ${to}`);
    assert.strictEqual(calls.length, 2, `${from} to ${to}`);
  }
});

test('Attachments: fromDataUri decodes base64 and percent-encoded bytes', async () => {
  const png = fromDataUri('data:image/png;base64,iVBO\nRw0K');
  assert.strictEqual(png.contentType, 'image/png');
  assert.strictEqual(png.filename, 'attachment.png');
  assert.deepStrictEqual([...png.content], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const text = fromDataUri('data:,Hello%2C%20World%FF');
  assert.strictEqual(text.contentType, 'text/plain');
  assert.deepStrictEqual(
    Buffer.from(text.content),
    Buffer.concat([Buffer.from('Hello, World'), Buffer.from([0xff])]),
  );
  assert.strictEqual(
    new TextDecoder().decode(fromDataUri('data:text/plain;charset=utf-8,Привіт').content),
    'Привіт',
  );
  assert.strictEqual(fromDataUri('DATA:Text/HTML;base64,PGI+').contentType, 'text/html');
});

test('Attachments: fromDataUri refuses what does not parse or is too long', () => {
  // nodemailer read a URI it could not parse as a file path, and turned one
  // over 50 MB into an empty attachment.
  const invalid = [
    'image/png;base64,AAAA',
    'data:image/png;base64',
    'data:image/png;base64,AA!A',
    'data:image/png;base64,AAAAA',
    'data:,100%',
    'data:,%G0',
    'data:not a type;base64,AAAA',
    42,
  ];
  for (const uri of invalid) assert.throws(() => fromDataUri(uri), /Invalid data URI/, String(uri));
  assert.throws(
    () => fromDataUri(`data:;base64,${'A'.repeat(4000)}`, { maxBytes: 1000 }),
    RangeError,
  );
  assert.throws(() => fromDataUri(`data:,${'a'.repeat(1001)}`, { maxBytes: 1000 }), RangeError);
  assert.throws(() => fromDataUri('data:,x', { maxBytes: -1 }), /maxBytes/);
  assert.throws(
    () => fromDataUri('data:,x', { filename: 'a\r\nb' }),
    /Invalid attachment filename/,
  );
  assert.throws(
    () => fromDataUri('data:,x', { contentType: 'pdf' }),
    /Invalid attachment content type/,
  );
  assert.throws(
    () => fromDataUri('data:,x', { contentId: 'a b' }),
    /Invalid attachment content ID/,
  );
  assert.throws(() => fromDataUri('data:,x', { inline: 'yes' }), /inline must be a boolean/);
});

test('Attachments: fromDataUri refuses a percent-encoded part that cannot fit before decoding it', () => {
  const tooLong = (uri, maxBytes) =>
    assert.throws(() => fromDataUri(uri, { maxBytes }), RangeError);
  // A byte takes at most three characters (%XX), so more than three times maxBytes cannot fit.
  // The invalid escapes are never read: before, the first one was a TypeError.
  tooLong(`data:,${'%G0'.repeat(1001)}`, 1000);
  tooLong(`data:,${'%41'.repeat(1000)}a`, 1000);
  // Fewer characters can still be too many bytes: a character is up to three.
  tooLong(`data:,${'é'.repeat(501)}`, 1000);
  tooLong(`data:,${'€'.repeat(334)}`, 1000);
  // The count is kept as the input is read, so the decoded part never outgrows maxBytes
  // before the check: it does not wait for an invalid escape at the end.
  tooLong(`data:,${'a'.repeat(1001)}%G0`, 1000);
  tooLong(`data:,%41${'a'.repeat(1000)}%G0`, 1000);
  // What fits is decoded, to the last byte.
  assert.strictEqual(
    fromDataUri(`data:,${'%41'.repeat(1000)}`, { maxBytes: 1000 }).content.length,
    1000,
  );
  assert.strictEqual(
    fromDataUri(`data:,${'é'.repeat(500)}`, { maxBytes: 1000 }).content.length,
    1000,
  );
  assert.strictEqual(
    fromDataUri(`data:,${'a'.repeat(999)}%41`, { maxBytes: 1000 }).content.length,
    1000,
  );
  assert.strictEqual(
    fromDataUri(`data:,${'😀'.repeat(250)}`, { maxBytes: 1000 }).content.length,
    1000,
  );
  // A part that is invalid and short enough is still invalid.
  assert.throws(() => fromDataUri('data:,a%G0', { maxBytes: 1000 }), /Invalid data URI/);
});

test('Attachments: fromStream reads a Node stream, a web stream or an async iterable once', async () => {
  const node = await fromStream(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), {
    filename: 'n.csv',
  });
  assert.strictEqual(await textOf(node), 'abcd');
  assert.strictEqual(node.contentType, 'text/csv');
  const web = await fromStream(new Blob(['web']).stream());
  assert.strictEqual(await textOf(web), 'web');
  assert.strictEqual(web.filename, 'attachment.bin');
  assert.strictEqual(web.contentType, 'application/octet-stream');
  const iterable = await fromStream(
    (async function* () {
      yield bytesOf('it');
    })(),
  );
  assert.strictEqual(await textOf(iterable), 'it');
  await assert.rejects(fromStream(Readable.from(['text'])), /reads bytes/);
  await assert.rejects(fromStream('text'), /async iterable of bytes/);
  await assert.rejects(
    fromStream(Readable.from([Buffer.alloc(2000)]), { maxBytes: 1000 }),
    RangeError,
  );
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(
    fromStream(Readable.from([Buffer.from('a')]), { signal: controller.signal }),
    /stop/,
  );
});

test('Attachments: inlineDataUrls makes inline attachments of the images of HTML', async () => {
  const pixel = 'iVBORw0KGgo=';
  const html =
    `<p><img alt="a" src="data:image/png;base64,${pixel}"></p>` +
    `<img src='data:image/gif;base64,R0lGODlh'>` +
    '<a href="data:text/plain;base64,aGk=">link</a>';
  let next = 0;
  const result = inlineDataUrls(html, { generateId: () => `id${++next}`, domain: 'example.com' });
  assert.strictEqual(
    result.html,
    '<p><img alt="a" src="cid:id1@example.com"></p><img src=\'cid:id2@example.com\'>' +
      '<a href="data:text/plain;base64,aGk=">link</a>',
  );
  assert.deepStrictEqual(
    result.attachments.map((attachment) => [
      attachment.filename,
      attachment.contentType,
      attachment.contentId,
      attachment.inline,
    ]),
    [
      ['image-1.png', 'image/png', 'id1@example.com', true],
      ['image-2.gif', 'image/gif', 'id2@example.com', true],
    ],
  );
  assert.deepStrictEqual(inlineDataUrls('<p>none</p>'), { html: '<p>none</p>', attachments: [] });
  assert.match(
    inlineDataUrls(`<img src="data:image/png;base64,${pixel}">`).html,
    /cid:[\w.-]+@localhost/,
  );
  assert.throws(() => inlineDataUrls('<img src="data:image/png;base64,!!!!">'), /Invalid data URI/);
  assert.throws(() => inlineDataUrls(42), TypeError);
  assert.throws(() => inlineDataUrls('', { domain: 'a b' }), /Content-ID domain/);
});

test('Attachments: inlineDataUrls reads a long input in linear time', () => {
  // The media type was `[^;]+`, which every `<img src=data:` start ran to the end of the
  // input: 30 KB took 80 ms, 240 KB 5 s, a megabyte a minute and a half.
  const sized = (unit, bytes) => unit.repeat(Math.ceil(bytes / unit.length));
  const time = (html) => {
    const start = process.hrtime.bigint();
    const result = inlineDataUrls(html);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    assert.strictEqual(result.html, html);
    assert.deepStrictEqual(result.attachments, []);
    return elapsed;
  };
  time(sized('<img src=data:x', 30_000));
  const one = time(sized('<img src=data:x', 1_000_000));
  const two = time(sized('<img src=data:x', 2_000_000));
  assert.ok(one < 100, `1 MB took ${one} ms`);
  // Twice the input, about twice the time; the floor keeps a fast run from a noisy ratio.
  assert.ok(two < 3 * Math.max(one, 10), `1 MB took ${one} ms, 2 MB ${two} ms`);
  // Other starts of a match that never completes.
  for (const unit of ['<img src=data:', '<img src="data:image/png', '<img src= ']) {
    const elapsed = time(sized(unit, 1_000_000));
    assert.ok(elapsed < 100, `${unit} took ${elapsed} ms`);
  }
});

test('Attachments: inlineDataUrls holds the media type to a token of at most 127 characters', () => {
  const pixel = 'iVBORw0KGgo=';
  const longest = `x/${'a'.repeat(125)}`;
  assert.strictEqual(longest.length, 127);
  const found = inlineDataUrls(`<img src="data:${longest};base64,${pixel}">`);
  assert.strictEqual(found.attachments.length, 1);
  // A type past 127 characters, or with a space or a quote, is not one: the image is left as it is.
  for (const type of [`${longest}a`, 'image/pn g', 'image/"png']) {
    const html = `<img src='data:${type};base64,${pixel}'>`;
    assert.deepStrictEqual(inlineDataUrls(html), { html, attachments: [] }, type);
  }
});

test('Attachments: a composed message carries them, read back by postal-mime', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, 'from a file');
  const { html, attachments } = inlineDataUrls('<img src="data:image/png;base64,iVBORw0KGgo=">');
  const message = createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'Files',
    content: { html },
    attachments: [
      await fromPath(file),
      fromDataUri('data:text/csv,a%2Cb'),
      await fromStream(Readable.from([Buffer.from('streamed')]), { filename: 's.txt' }),
      ...attachments,
    ],
  });
  const composed = await composeMessage(message);
  const parsed = await PostalMime.parse(await readAttachmentContent(composed.content));
  const found = {};
  for (const attachment of parsed.attachments) {
    found[attachment.filename] = [
      attachment.mimeType,
      new TextDecoder().decode(attachment.content),
      attachment.related === true,
    ];
  }
  assert.deepStrictEqual(found['notes.txt'], ['text/plain', 'from a file', false]);
  assert.deepStrictEqual(found['attachment.csv'], ['text/csv', 'a,b', false]);
  assert.deepStrictEqual(found['s.txt'], ['text/plain', 'streamed', false]);
  assert.strictEqual(found['image-1.png'][2], true);
});
