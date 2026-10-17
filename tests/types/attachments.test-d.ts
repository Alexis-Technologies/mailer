import { expectError, expectType } from 'tsd';
import { createMessage, type Attachment } from '../../index.js';
import {
  fromDataUri,
  fromPath,
  fromStream,
  fromUrl,
  inlineDataUrls,
  isPublicUrl,
} from '../../src/attachments/index.js';

expectType<Promise<Attachment>>(fromPath('./report.pdf', { root: '/srv/files' }));
expectType<Promise<Attachment>>(
  fromUrl(new URL('https://example.com/a.png'), {
    fetch: globalThis.fetch,
    headers: { authorization: 'Bearer x' },
    timeout: 1000,
    maxBytes: 1024,
    maxRedirects: 0,
    allowUrl: async (url) => url.hostname === 'example.com',
    inline: true,
    contentId: 'logo@example.com',
  }),
);
expectType<Attachment>(fromDataUri('data:text/plain,hi', { filename: 'hi.txt' }));
expectType<Promise<Attachment>>(fromStream(new ReadableStream<Uint8Array>()));
const inlined = inlineDataUrls('<img src="data:image/png;base64,AA==">', { domain: 'example.com' });
expectType<string>(inlined.html);
expectType<readonly Attachment[]>(inlined.attachments);
expectType<boolean>(isPublicUrl(new URL('https://example.com')));

createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { html: inlined.html },
  attachments: [fromDataUri('data:,x'), ...inlined.attachments],
});

expectError(fromPath(42));
expectError(fromUrl('https://example.com', { contentType: 'pdf' }));
expectError(fromDataUri('data:,x', { inline: 'yes' }));
