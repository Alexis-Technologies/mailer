import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type RawTransport, type VerifiableTransport } from '../../index.js';
import { SparkPostTransport, type SparkPostReceipt } from '../../src/sparkpost/index.js';

const transport = new SparkPostTransport({
  apiKey: 'sp-key',
  region: 'eu',
  campaignId: 'autumn',
  transactional: true,
  openTracking: false,
  concurrency: 2,
});
expectType<'sparkpost'>(transport.id);
expectAssignable<RawTransport<'sparkpost'>>(transport);
expectAssignable<VerifiableTransport<'sparkpost'>>(transport);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<SparkPostReceipt>>(transport.send(message));
expectType<AsyncIterable<SparkPostReceipt>>(transport.sendMany([message]));
expectType<Promise<void>>(transport.verify());
const receipt = await transport.send(message);
if (receipt.successful) expectType<number | undefined>(receipt.rejectedRecipientCount);
expectError(new SparkPostTransport({}));
expectError(new SparkPostTransport({ apiKey: 'k', region: 'asia' }));
