import { expectAssignable, expectError, expectType } from 'tsd';
import type { DiscordMessage, Receipt, SlackMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { DiscordTransport } from '../../src/discord/index.js';

const discord = new DiscordTransport({ botToken: 'token', retries: 1, concurrency: 2 });
new DiscordTransport({ webhookUrl: 'https://discord.com/api/webhooks/1/x' });
expectError(new DiscordTransport({}));
expectType<'discord'>(discord.id);
const message = createChannelMessage({
  channel: 'discord',
  to: '1',
  text: 'Hi',
  mentions: { everyone: false, users: ['2'] },
});
expectType<Promise<Receipt<'discord'>>>(discord.send(message));
expectType<Promise<void>>(discord.verify());
expectAssignable<Transport<'discord', DiscordMessage>>(discord);
declare const slack: SlackMessage;
expectError(discord.send(slack));
