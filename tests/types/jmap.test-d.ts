import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createMessage,
  type RawTransport,
  type Receipt,
  type VerifiableTransport,
} from '../../index.js';
import {
  JMAP_ERROR_TYPES,
  JmapApiError,
  JmapTransport,
  createJmapConfig,
  isCapabilityError,
  type JmapConfig,
  type ResolvedJmapConfig,
} from '../../src/jmap/index.js';

const transport = new JmapTransport({
  sessionUrl: 'https://jmap.example.com/.well-known/jmap',
  bearerToken: 'token',
});
expectAssignable<RawTransport<'jmap'>>(transport);
expectAssignable<VerifiableTransport<'jmap'>>(transport);
expectType<ResolvedJmapConfig>(
  createJmapConfig({
    sessionUrl: 'https://jmap.example.com/.well-known/jmap',
    basicAuth: { username: 'alex', password: 'secret' },
  }),
);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'jmap'>>>(transport.send(message));
expectType<Promise<void>>(transport.verify());

expectAssignable<JmapConfig>({ sessionUrl: 'https://x', bearerToken: 't', accountId: 'a1' });
expectAssignable<Error>(new JmapApiError('Bad request', 400));
expectType<boolean>(isCapabilityError(new Error('x')));
expectType<'urn:ietf:params:jmap:error:unknownCapability'>(JMAP_ERROR_TYPES.unknownCapability);
expectError(new JmapTransport({ bearerToken: 'token' }));
