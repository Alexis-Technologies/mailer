import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SlackMessage, TeamsMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { TeamsTransport } from '../../src/teams/index.js';

const webhook = new TeamsTransport({ webhookUrl: 'https://example.logic.azure.com/x' });
const bot = new TeamsTransport({
  bot: { appId: 'app', clientSecret: 'secret', tenantId: 'contoso.onmicrosoft.com' },
  serviceUrls: ['https://bots.example.com'],
});
expectError(new TeamsTransport({ bot: { appId: 'app' } }));
expectType<'teams'>(webhook.id);
expectType<Promise<Receipt<'teams'>>>(
  bot.send(
    createChannelMessage({
      channel: 'teams',
      to: { serviceUrl: 'https://smba.trafficmanager.net/emea/', conversationId: '19:a' },
      text: 'Hi',
    }),
  ),
);
expectAssignable<Transport<'teams', TeamsMessage>>(webhook);
declare const slack: SlackMessage;
expectError(webhook.send(slack));
