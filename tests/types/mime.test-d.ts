import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, RawMessageValidationError, type RawMessage } from '../../index.js';
import {
  composeMessage,
  MimeAttachmentReplayError,
  type ComposedMessage,
  type DkimConfig,
} from '../../src/mime/index.js';

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
const dkim: DkimConfig = {
  signatures: [{ signingDomain: 'example.com', selector: 'mail', privateKey: '-----BEGIN…' }],
  bodyMode: 'streaming',
  onSigningFailure: 'send-unsigned',
};
expectType<Promise<ComposedMessage>>(composeMessage(message, { dkim }));
expectAssignable<Promise<RawMessage>>(composeMessage(message));
const composed = {} as ComposedMessage;
expectType<'7bit' | 'utf8'>(composed.encoding);
expectType<AsyncIterable<Uint8Array>>(composed.content());
expectAssignable<RawMessageValidationError>(new MimeAttachmentReplayError());

expectError(composeMessage({ subject: 'not a message' }));
expectError<DkimConfig>({ signatures: [{ signingDomain: 'example.com', algorithm: 'rsa-sha1' }] });

expectType<Promise<ComposedMessage>>(composeMessage(message, { generateId: () => '01JMIME' }));
