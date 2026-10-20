// Not ported: tests of ./render, ported from unemail's render tests, with the
// React Email adapter run on @react-email/render, a devDependency.
const { test } = require('node:test');
const assert = require('node:assert');
const React = require('react');
const { render } = require('@react-email/render');
const { createMessage } = require('../../index.js');
const {
  createReactEmailRenderer,
  htmlToText,
  renderContent,
  renderFields,
} = require('../../src/render/index.js');

const h = React.createElement;

test('Render: htmlToText keeps the cases of unemail', () => {
  assert.strictEqual(htmlToText('<p>one</p><p>two</p>'), 'one\n\ntwo');
  assert.strictEqual(htmlToText('a<br>b'), 'a\nb');
  assert.strictEqual(htmlToText('<a href="https://acme.com">Acme</a>'), 'Acme (https://acme.com)');
  assert.strictEqual(
    htmlToText('<a href="https://acme.com">https://acme.com</a>'),
    'https://acme.com',
  );
  assert.strictEqual(
    htmlToText('<style>p{color:red}</style><script>evil()</script><p>safe</p>'),
    'safe',
  );
  assert.strictEqual(htmlToText('<p>a &amp; b</p>'), 'a & b');
  assert.strictEqual(htmlToText('<p>&amp;lt;</p>'), '&lt;');
  assert.strictEqual(htmlToText('<p>&#8364; &#x20AC;</p>'), '€ €');
  assert.strictEqual(htmlToText('<div><div><div>x</div></div></div>'), 'x');
});

test('Render: comments, the doctype and the head are not text', () => {
  // Changed in the port: unemail left `<!DOCTYPE …>` and `<!--$-->` in the text.
  assert.strictEqual(
    htmlToText(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"><html><head>' +
        '<title>Subject</title><meta charset="utf-8"><style>a{}</style></head><body>' +
        '<!--$--><!--[if mso]><p>Outlook only</p><![endif]--><p>Hello</p><!--/$--></body></html>',
    ),
    'Hello',
  );
  assert.strictEqual(htmlToText('<?xml version="1.0"?><p>x</p><!-- never closed'), 'x');
});

test('Render: a link keeps where it goes, however its href is quoted', () => {
  // Changed in the port: unemail read an href in double quotes only.
  assert.strictEqual(htmlToText("<a href='https://e.com'>there</a>"), 'there (https://e.com)');
  assert.strictEqual(
    htmlToText('<a class=x href=https://e.com/a?b=1&amp;c=2>go</a>'),
    'go (https://e.com/a?b=1&c=2)',
  );
  assert.strictEqual(htmlToText('<a href="mailto:help@e.com">help@e.com</a>'), 'help@e.com');
  assert.strictEqual(
    htmlToText('<a href="mailto:help@e.com">Write</a>'),
    'Write (mailto:help@e.com)',
  );
  assert.strictEqual(
    htmlToText('<a href="https://e.com"><img src="logo.png"></a>'),
    'https://e.com',
  );
  assert.strictEqual(
    htmlToText('<a href="#top">Top</a> <a href="javascript:x()">x</a> <a>none</a>'),
    'Top x none',
  );
  assert.strictEqual(
    htmlToText('<a href="https://e.com">a <b>bold</b> link</a>'),
    'a bold link (https://e.com)',
  );
  assert.strictEqual(htmlToText('</a>stray'), 'stray');
});

test('Render: references decode once, an invalid number as U+FFFD', () => {
  // Changed in the port: unemail threw a RangeError past U+10FFFF.
  assert.strictEqual(htmlToText('&#99999999; &#0; &#xD800; &#x1F600;'), '� � � 😀');
  assert.strictEqual(
    htmlToText('&mdash;&ndash;&hellip;&rsquo;&ldquo;&rdquo;&copy;&euro;&nbsp;x'),
    '—–…’“”©€ x',
  );
  assert.strictEqual(htmlToText('&unknown; &amp &#; AT&amp;T'), '&unknown; &amp &#; AT&T');
});

test('Render: whitespace collapses but in pre, and lists get their markers', () => {
  assert.strictEqual(htmlToText('<p>\n  Hello\n    world  </p>'), 'Hello world');
  assert.strictEqual(htmlToText('<pre>  a\r\n   b</pre>after'), '  a\n   b\n\nafter');
  assert.strictEqual(
    htmlToText('<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>'),
    '- one\n- two\n\n1. first\n2. second',
  );
  assert.strictEqual(htmlToText('<li>loose</li></ul></ol></pre>'), '- loose');
  assert.strictEqual(htmlToText('<table><tr><td>a</td><td>b</td></tr></table>'), 'a\nb');
  assert.strictEqual(htmlToText('a<br><br><br>b'), 'a\n\nb');
  assert.strictEqual(htmlToText('<br>a'), 'a');
  assert.strictEqual(htmlToText('1 < 2 and 3 > 2'), '1 < 2 and 3 > 2');
  assert.strictEqual(htmlToText('<span>a</span><span>b</span> <em>c</em>'), 'ab c');
});

test('Render: what is marked data-skip-in-text is left out, with what it holds', () => {
  assert.strictEqual(
    htmlToText(
      '<div data-skip-in-text="true">Preview <div>nested</div><br/>text</div><div>Body</div>',
    ),
    'Body',
  );
  assert.strictEqual(htmlToText('<div data-skip-in-text="false">kept</div>'), 'kept');
  assert.strictEqual(htmlToText('<img data-skip-in-text="true" alt="x">after'), 'after');
  assert.strictEqual(htmlToText('<p data-skip-in-text="true">never closed'), '');
});

test('Render: htmlToText is linear in its input', () => {
  // unemail rescanned the rest of the input for each unclosed `<a` or `<script`.
  const started = process.hrtime.bigint();
  for (const piece of ['<a href="x">', '<script>', '<p a="', '<!--', '&a', '<x ']) {
    htmlToText(piece.repeat(100_000));
  }
  htmlToText(
    '<a href="https://e.com">'.repeat(20_000) + 'x'.repeat(20_000) + '</a>'.repeat(20_000),
  );
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 2000, `took ${elapsedMs} ms`);
  assert.throws(() => htmlToText(undefined), /htmlToText takes a string/);
});

test('Render: the spaces and tabs before a break are dropped, in however many pieces', () => {
  assert.strictEqual(htmlToText('a<b> </b><p>b'), 'a\n\nb');
  assert.strictEqual(htmlToText('x<i> </i><i>\t</i> <br>y'), 'x\ny');
  assert.strictEqual(htmlToText('<pre>a  </pre>b'), 'a\n\nb');
  assert.strictEqual(htmlToText('<pre> \t </pre>'), '');
  // The break after the link's opening trims the output below where its
  // label starts.
  assert.strictEqual(htmlToText('x <a href="h"><p>y</p></a>'), 'x\n\ny (h)');
  assert.strictEqual(htmlToText('<a href="h"> </a>z'), 'hz');
});

test('Render: htmlToText takes time in proportion to its input, not its square', () => {
  // The output was a string grown with `+=` and read at its end for each
  // piece of text (`endsWith`, an index, the `slice` of a link's label); V8
  // flattens such a rope on every read, so a megabyte of `a <p>` took
  // seconds.  Ratios, not limits, so that a slow machine does not fail it.
  const bestOf = (input) => {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = process.hrtime.bigint();
      htmlToText(input);
      best = Math.min(best, Number(process.hrtime.bigint() - started) / 1e6);
    }
    return best;
  };
  const megabyte = 1024 * 1024;
  for (const piece of ['a <p>', '<', '<a href="h">x</a>']) {
    const quarter = bestOf(piece.repeat(Math.ceil(megabyte / 4 / piece.length)));
    const whole = bestOf(piece.repeat(Math.ceil(megabyte / piece.length)));
    if (piece === 'a <p>') assert.ok(whole < 1000, `1 MB of ${piece} took ${whole} ms`);
    // Linear is about 4 and quadratic 16: 8 is as far from each, so that the
    // noise of a busy runner (a garbage collection more in the larger run)
    // does not decide it, as it did between 1 and 2 MB; the floor keeps a few
    // milliseconds of it from deciding either.
    assert.ok(
      whole <= 8 * Math.max(quarter, 25),
      `${piece}: 256 KB ${quarter} ms, 1 MB ${whole} ms`,
    );
  }
});

test('Render: renderContent derives the text, or keeps the one given', async () => {
  const upper = { render: (source) => ({ html: `<p>${source.toUpperCase()}</p>` }) };
  assert.deepStrictEqual(await renderContent(upper, 'hello'), {
    html: '<p>HELLO</p>',
    text: 'HELLO',
  });
  assert.deepStrictEqual(await renderContent(upper, 'hello', { autoText: false }), {
    html: '<p>HELLO</p>',
  });
  const own = { render: async () => ({ html: '<p>rich</p>', text: 'own text' }) };
  assert.deepStrictEqual(await renderContent(own), { html: '<p>rich</p>', text: 'own text' });
  assert.deepStrictEqual(await renderContent({ render: () => ({ text: 'plain' }) }), {
    text: 'plain',
  });
  const message = createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'Hi',
    content: await renderContent(upper, 'hello'),
  });
  assert.deepStrictEqual(message.content, { html: '<p>HELLO</p>', text: 'HELLO' });
  await assert.rejects(renderContent({}, 'x'), /renderer must have a render method/);
  await assert.rejects(
    renderContent(upper, 'x', { autoText: 'yes' }),
    /autoText must be a boolean/,
  );
  await assert.rejects(renderContent({ render: () => ({}) }), /neither html nor text/);
  await assert.rejects(renderContent({ render: () => undefined }), /neither html nor text/);
  await assert.rejects(renderContent({ render: () => ({ html: 1 }) }), /as strings/);
  await assert.rejects(renderContent({ render: () => ({ html: '', text: 2 }) }), /as strings/);
});

test('Render: renderFields gives the subject beside the content', async () => {
  const titled = {
    render: ({ name }) => ({ html: `<p>Hi ${name}</p>`, subject: `Welcome, ${name}` }),
  };
  assert.deepStrictEqual(await renderFields(titled, { name: 'Ada' }), {
    subject: 'Welcome, Ada',
    content: { html: '<p>Hi Ada</p>', text: 'Hi Ada' },
  });
  assert.deepStrictEqual(await renderFields(titled, { name: 'Ada' }, { autoText: false }), {
    subject: 'Welcome, Ada',
    content: { html: '<p>Hi Ada</p>' },
  });
  // A renderer without a subject gives none, and renderContent leaves it out.
  const plain = { render: () => ({ text: 'plain' }) };
  assert.deepStrictEqual(await renderFields(plain), { content: { text: 'plain' } });
  assert.deepStrictEqual(await renderContent(titled, { name: 'Ada' }), {
    html: '<p>Hi Ada</p>',
    text: 'Hi Ada',
  });
  await assert.rejects(renderFields({}, 'x'), /renderer must have a render method/);
  await assert.rejects(renderFields(plain, 'x', { autoText: 1 }), /autoText must be a boolean/);
  await assert.rejects(
    renderFields({ render: () => ({ text: 'x', subject: 1 }) }),
    /subject as a string/,
  );
  await assert.rejects(renderFields({ render: () => undefined }), /neither html nor text/);
});

test('Render: the React Email renderer runs on @react-email/render', async () => {
  const reactEmail = createReactEmailRenderer({ render });
  const welcome = (name) =>
    h(
      'html',
      null,
      h('body', null, [
        h('div', { key: 'preview', 'data-skip-in-text': true }, 'Your account is ready'),
        h('p', { key: 'greeting' }, `Welcome, ${name}`),
        h('a', { key: 'link', href: 'https://example.com/start' }, 'Get started'),
      ]),
    );
  const content = await renderContent(reactEmail, welcome('Ada'));
  assert.match(content.html, /<p[^>]*>Welcome, Ada<\/p>/);
  assert.match(content.text, /Welcome, Ada/);
  assert.match(content.text, /https:\/\/example\.com\/start/);
  // Without React Email's own pass, the text is derived, the preview left out.
  const derived = await renderContent(
    createReactEmailRenderer({ render, plainText: false }),
    welcome('Ada'),
  );
  assert.strictEqual(derived.text, 'Welcome, Ada\n\nGet started (https://example.com/start)');
});

test('Render: the React Email renderer passes its options, and fails as render fails', async () => {
  const calls = [];
  const fake = (element, options) => {
    calls.push([element, options]);
    if (options?.plainText && element === 'broken') throw new Error('no plain text');
    return options?.plainText ? `text of ${element}` : `<p>${element}</p>`;
  };
  const reactEmail = createReactEmailRenderer({ render: fake, renderOptions: { pretty: true } });
  assert.deepStrictEqual(await reactEmail.render('x'), { html: '<p>x</p>', text: 'text of x' });
  assert.deepStrictEqual(calls, [
    ['x', { pretty: true }],
    ['x', { pretty: true, plainText: true }],
  ]);
  // Changed in the port: unemail fell back to the derived text unseen.
  await assert.rejects(reactEmail.render('broken'), /no plain text/);
  await assert.rejects(reactEmail.render(null), /needs an element/);
  assert.throws(() => createReactEmailRenderer(), /needs render/);
  assert.throws(() => createReactEmailRenderer({ render: fake, plainText: 1 }), /plainText/);
});
