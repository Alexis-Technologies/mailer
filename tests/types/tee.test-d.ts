import { expectAssignable, expectError, expectType } from 'tsd';
import {
  createMessage,
  type RawTransport,
  type Receipt,
  type Transport,
  type VerifiableTransport,
} from '../../index.js';
import { TeeTransport, type MirrorOutcome } from '../../src/tee/index.js';

declare const primary: Transport<'ses'>;
declare const mirror: Transport<'mock'>;
const tee = new TeeTransport(primary, {
  mirrors: [mirror],
  timeout: 5000,
  awaitMirrors: true,
  maxPending: 10,
  onMirror: (outcome) => {
    expectType<MirrorOutcome>(outcome);
    expectType<string>(outcome.mirror);
  },
});
expectType<'ses'>(tee.id);
expectAssignable<RawTransport<'ses'>>(tee);
expectAssignable<VerifiableTransport<'ses'>>(tee);
const message = createMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'x',
  content: { text: 'x' },
});
expectType<Promise<Receipt<'ses'>>>(tee.send(message));
expectType<AsyncIterable<Receipt<'ses'>>>(tee.sendMany([message]));
expectError(new TeeTransport(primary, {}));
// A pino-like logger.
new TeeTransport(primary, { mirrors: [primary], logger: { warn() {} } });
expectError(new TeeTransport(primary, { mirrors: [primary], logger: 'pino' }));
