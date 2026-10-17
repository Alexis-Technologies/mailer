import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type VerifiableTransport } from '../../index.js';
import { AzureTransport } from '../../src/azure/index.js';

const transport = new AzureTransport({
  connectionString: 'endpoint=https://r.communication.azure.com/;accesskey=a2V5',
  apiVersion: '2025-09-01',
  userEngagementTrackingDisabled: true,
  concurrency: 2,
  now: () => Date.now(),
});
expectType<'azure'>(transport.id);
expectAssignable<VerifiableTransport<'azure'>>(transport);
new AzureTransport({ endpoint: 'https://r.communication.azure.com', accessKey: 'a2V5' });
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'azure'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'azure'>>>(transport.sendMany([message]));
expectType<Promise<void>>(transport.verify());
expectError(new AzureTransport({}));
expectError(new AzureTransport({ endpoint: 'https://r.communication.azure.com' }));
expectError(
  new AzureTransport({
    connectionString: 'endpoint=https://r;accesskey=a2V5',
    endpoint: 'https://r',
    accessKey: 'a2V5',
  }),
);
