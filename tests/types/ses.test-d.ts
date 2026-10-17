import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import { SesTransport, type SesAuthentication, type SesConfig } from '../../src/ses/index.js';

const authentication: SesAuthentication = {
  type: 'credentials',
  accessKeyId: 'AKID',
  secretAccessKey: 'secret',
};
const transport = new SesTransport({ authentication, region: 'eu-west-1', retries: 2 });
expectAssignable<Transport<'ses'>>(transport);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'ses'>>>(transport.send(message));
expectType<AsyncIterable<Receipt<'ses'>>>(transport.sendMany([message]));

expectAssignable<SesConfig>({
  authentication: { type: 'session', accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'T' },
  configurationSetName: 'transactional',
  defaultTags: { app: 'billing' },
});
expectError(new SesTransport({ region: 'eu-west-1' }));
expectError<SesAuthentication>({ type: 'session', accessKeyId: 'A', secretAccessKey: 'S' });
