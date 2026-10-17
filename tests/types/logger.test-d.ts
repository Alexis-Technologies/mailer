import pino from 'pino';
import { expectAssignable, expectError, expectType } from 'tsd';
import { createMessage, type Receipt, type Transport } from '../../index.js';
import { MockTransport } from '../../src/mock/index.js';
import {
  LoggerTransport,
  type Logger,
  type LoggerTransportOptions,
} from '../../src/logger/index.js';

// A pino logger, and a child of one, fit the structural type.
const logger = pino();
expectAssignable<Logger>(logger);
expectAssignable<Logger>(logger.child({ component: 'mail' }));

const logOnly = new LoggerTransport({ logger });
expectType<'logger'>(logOnly.id);
expectAssignable<Transport<'logger'>>(logOnly);
expectAssignable<AsyncDisposable>(logOnly);

const decorated = new LoggerTransport({
  logger,
  transport: new MockTransport(),
  recordMessage: 'properties',
  levels: { sending: 'trace', sent: 'warn', failed: 'fatal' },
});
expectAssignable<Transport<'mock'>>(decorated);

const message = createMessage({
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
});
expectType<Promise<Receipt<'mock'>>>(decorated.send(message));

// Upstream's type-level checks: a provider id needs a wrapped transport, and
// recordMessage is not a boolean.
expectError(new LoggerTransport<'base'>({ logger }));
expectError(new LoggerTransport({ logger, recordMessage: true }));
expectError(new LoggerTransport({}));
expectError<LoggerTransportOptions>({ logger, levels: { sent: 'warning' } });
