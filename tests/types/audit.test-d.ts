import { expectAssignable, expectError, expectType } from 'tsd';
import type { AuditEvent, AuditSink, DeliveryEvent, MessageState } from '../../index.js';
import {
  auditEventOfDeliveryEvent,
  combineAuditSinks,
  createLoggerAuditSink,
  createMemoryAuditSink,
  isFinalState,
  stateOf,
  stateOfDeliveryEvent,
  type MemoryAuditSink,
} from '../../src/audit/index.js';

const memory = createMemoryAuditSink({ maxEvents: 100 });
expectType<MemoryAuditSink>(memory);
expectAssignable<AuditSink>(memory);
expectType<readonly AuditEvent[]>(memory.events);
expectType<MessageState | undefined>(memory.stateOf('c'));
declare const logger: { info(record: object, message?: string): void };
const logged = createLoggerAuditSink(logger, { levels: { failed: 'fatal', queued: 'debug' } });
expectError(createLoggerAuditSink(logger, { levels: { failed: 'loud' } }));
const custom: AuditSink = {
  append: async (event, context) => void [event.state, context?.transaction],
};
expectAssignable<AuditSink>(combineAuditSinks(memory, logged, custom));
declare const delivery: DeliveryEvent;
expectType<MessageState | undefined>(stateOfDeliveryEvent(delivery));
expectType<AuditEvent | undefined>(auditEventOfDeliveryEvent(delivery, { now: Date.now }));
expectType<boolean>(isFinalState('delivered'));
expectError(isFinalState('nope'));
expectType<MessageState | undefined>(stateOf(memory.events));
