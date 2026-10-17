import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type RawTransport, type VerifiableTransport } from '../../index.js';
import { CloudflareTransport, type CloudflareReceipt } from '../../src/cloudflare/index.js';

const transport = new CloudflareTransport({
  accountId: 'account',
  apiToken: 'token',
  concurrency: 2,
});
expectType<'cloudflare'>(transport.id);
expectAssignable<RawTransport<'cloudflare'>>(transport);
expectAssignable<VerifiableTransport<'cloudflare'>>(transport);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<CloudflareReceipt>>(transport.send(message));
expectType<AsyncIterable<CloudflareReceipt>>(transport.sendMany([message]));
expectType<Promise<void>>(transport.verify());
const receipt = await transport.send(message);
if (receipt.successful) {
  expectType<readonly string[] | undefined>(receipt.bouncedRecipients);
  expectType<readonly string[] | undefined>(receipt.suppressedRecipients);
}
expectError(new CloudflareTransport({ accountId: 'a' }));
