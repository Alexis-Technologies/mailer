import { expectAssignable, expectError, expectType } from 'tsd';
import type { GoogleChatMessage, Receipt, SlackMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { GoogleChatTransport, type GoogleServiceAccount } from '../../src/google-chat/index.js';

declare const serviceAccount: GoogleServiceAccount;
const webhook = new GoogleChatTransport({ webhookUrl: 'https://chat.googleapis.com/v1/x' });
const app = new GoogleChatTransport({ serviceAccount, concurrency: 2 });
expectError(new GoogleChatTransport({ serviceAccount: 'json' }));
expectType<'google-chat'>(app.id);
expectType<Promise<Receipt<'google-chat'>>>(
  app.send(
    createChannelMessage({ channel: 'google-chat', to: 'spaces/AAAA', text: 'Hi', thread: 'x' }),
  ),
);
expectType<Promise<void>>(webhook.verify());
expectAssignable<Transport<'google-chat', GoogleChatMessage>>(webhook);
declare const slack: SlackMessage;
expectError(webhook.send(slack));
