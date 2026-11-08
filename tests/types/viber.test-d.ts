import { expectAssignable, expectError, expectType } from 'tsd';
import type { Receipt, ViberMessage, TelegramMessage, Transport } from '../../index.js';
import { createChannelMessage } from '../../src/channels/index.js';
import { ViberTransport } from '../../src/viber/index.js';

const viber = new ViberTransport({ authToken: 't', sender: { name: 'Shop' } });
expectError(new ViberTransport({ authToken: 't' }));
expectType<'viber'>(viber.id);
expectType<Promise<Receipt<'viber'>>>(
  viber.send(createChannelMessage({ channel: 'viber', to: '01234567890A=', text: 'Hi' })),
);
expectAssignable<Transport<'viber', ViberMessage>>(viber);
declare const telegram: TelegramMessage;
expectError(viber.send(telegram));
