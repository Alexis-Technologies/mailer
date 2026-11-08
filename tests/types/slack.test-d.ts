import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, SlackMessage, TelegramMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { SlackTransport } from '../../src/slack/index.js';

const slack = new SlackTransport({ botToken: 'xoxb-1', retries: 1, concurrency: 2 });
new SlackTransport({ webhookUrl: 'https://hooks.slack.com/services/T/B/X' });
new SlackTransport({ botToken: 'xoxb-1', webhookUrl: 'https://hooks.slack.com/services/T/B/X' });
expectError(new SlackTransport({}));
expectType<'slack'>(slack.id);
const message = createChannelMessage({ channel: 'slack', to: 'C1', text: 'Hi', thread: '1.2' });
expectType<Promise<Receipt<'slack'>>>(slack.send(message));
expectType<Promise<void>>(slack.verify());
expectAssignable<Transport<'slack', SlackMessage>>(slack);
declare const telegram: TelegramMessage;
expectError(slack.send(telegram));
