// Not ported: the types of ./audit, the states of a message and the sinks of
// its events.

import type { AuditEvent, AuditSink, DeliveryEvent, Logger, MessageState } from '../../index.js';

/** An audit sink in memory, with what it holds. */
export interface MemoryAuditSink extends AuditSink {
  append(event: AuditEvent): void;
  appendMany(events: readonly AuditEvent[]): void;
  has(id: string): boolean;
  /** Its events, in the order they came, one per id. */
  readonly events: readonly AuditEvent[];
  /** The events of one message. */
  eventsOf(correlationId: string): readonly AuditEvent[];
  /** The state of one message: see {@link stateOf}. */
  stateOf(correlationId: string): MessageState | undefined;
  clear(): void;
}

/** The options of {@link createMemoryAuditSink}. */
export interface MemoryAuditSinkOptions {
  /** The most events held, the oldest dropped first. @default 10000 */
  readonly maxEvents?: number;
}

/**
 * Makes an audit sink that holds its events in memory, for tests and a
 * single process. An event told again under its id is written once.
 *
 * @throws {TypeError} If `maxEvents` is not a positive integer.
 */
export declare function createMemoryAuditSink(options?: MemoryAuditSinkOptions): MemoryAuditSink;

/** The level of a logger. */
export type AuditLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** The options of {@link createLoggerAuditSink}. */
export interface LoggerAuditSinkOptions {
  /**
   * The level of each state, over the defaults: `failed` at error;
   * `delivery_unknown`, `bounced` and `complained` at warn; `rendered` and
   * `submitted` at debug; the rest at info.
   */
  readonly levels?: Partial<Readonly<Record<MessageState, AuditLogLevel>>>;
}

/**
 * Makes an audit sink that writes each event as a record of a pino-like
 * logger, its message `mail.<state>`.
 *
 * @throws {TypeError} If the logger is none or a level is unknown.
 */
export declare function createLoggerAuditSink(
  logger: Logger,
  options?: LoggerAuditSinkOptions,
): AuditSink;

/**
 * Makes one sink of several, each told every event in turn whatever another
 * threw; it rejects with what one threw, or an `AggregateError`.
 *
 * @throws {TypeError} If one is not a sink.
 */
export declare function combineAuditSinks(...sinks: readonly AuditSink[]): AuditSink;

/**
 * The state of a message a delivery event tells: `accepted` (and `deferred`,
 * which keeps it accepted), `delivered`, `bounced`, `complained`, `failed` for
 * `rejected`; `undefined` for an open, a click, an unsubscribe and the
 * unknown.
 */
export declare function stateOfDeliveryEvent(event: DeliveryEvent): MessageState | undefined;

/** The options of {@link auditEventOfDeliveryEvent}. */
export interface AuditEventOfDeliveryEventOptions {
  /** The time of an event that says not when it happened. @default Date.now */
  readonly now?: () => number;
}

/**
 * The audit event of a delivery event: found by the `correlationId` the
 * message's metadata gave back (which `./queue` always writes), or by the
 * provider's id of the message.
 *
 * @returns The audit event, or `undefined` when the event tells no state or
 * names no message.
 */
export declare function auditEventOfDeliveryEvent(
  event: DeliveryEvent,
  options?: AuditEventOfDeliveryEventOptions,
): AuditEvent | undefined;

/** Whether no later state but a complaint follows: `delivered`, `bounced`, `complained` and `failed`. */
export declare function isFinalState(state: MessageState): boolean;

/**
 * The state of a message from its events, whatever the order they came in:
 * the furthest along `queued`, `rendered`, `submitted`, `accepted` or
 * `delivery_unknown`, `delivered` or `failed`, `bounced`, `complained`.
 */
export declare function stateOf(events: Iterable<AuditEvent>): MessageState | undefined;
