import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type VerifiableTransport } from '../../index.js';
import { ScalewayTransport } from '../../src/scaleway/index.js';

const transport = new ScalewayTransport({
  secretKey: 'scw-key',
  projectId: 'project',
  region: 'fr-par',
  concurrency: 2,
});
expectType<'scaleway'>(transport.id);
expectAssignable<VerifiableTransport<'scaleway'>>(transport);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'scaleway'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'scaleway'>>>(transport.sendMany([message]));
expectType<Promise<void>>(transport.verify());
expectError(new ScalewayTransport({ secretKey: 'k' }));
