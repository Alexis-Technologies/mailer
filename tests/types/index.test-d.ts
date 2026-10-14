import { expectError, expectType } from 'tsd';
import { createMailer, type Mailer } from '../../index.js';

const mailer = createMailer({});
expectType<Mailer>(mailer);
expectType<Promise<unknown>>(mailer.send({ to: 'alex@example.com', subject: 'Hello' }));

expectError(createMailer());
expectError(createMailer('smtp://localhost'));
expectError(mailer.send('Hello'));
