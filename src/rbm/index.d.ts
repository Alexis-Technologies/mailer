// Not ported: the types of ./rbm, a transport of RCS over Google's RCS
// Business Messaging.

import type { GoogleServiceAccount } from '../fcm/index.js';
import type {
  RcsMessage,
  Receipt,
  Transport,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

export type { GoogleServiceAccount };

/**
 * The options of {@link RbmTransport}.
 */
export interface RbmConfig extends TransportDependencies {
  /**
   * The service account of the agent, as its console gives it: its token is
   * asked for once and shared until five minutes before its end.
   */
  readonly serviceAccount: GoogleServiceAccount;
  /** The id of the agent, as RBM defines it. */
  readonly agentId: string;
  /** The region of the API. @default "global" */
  readonly region?: 'global' | 'europe' | 'asia';
  /** @default the host of the region, such as "https://europe-rcsbusinessmessaging.googleapis.com" */
  readonly baseUrl?: string;
  /** @default "https://oauth2.googleapis.com/token" */
  readonly tokenUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request: a 429, a 5xx, a timeout or a lost answer, each
   * under the same `messageId`, which the API takes once.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 10 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the token. @default Date.now */
  readonly now?: () => number;
}

/**
 * A transport of RCS over the RCS Business Messaging API of Google
 * (`phones.agentMessages.create`).  A message goes as its text, one medium
 * by URL (a standalone rich card when it has a text too), its buttons as
 * suggestions (a reply, a link, a call), and `expiresAt` as its
 * `expireTime`; `payload` holds the fields of the AgentMessage over those,
 * merged key by key (`contentMessage.richCard`, `messageTrafficType`).
 *
 * Its `messageId` is a UUID of the idempotency key (a random one without),
 * which the API takes once: a lost answer is sent again under it, and one
 * the API has already is of unknown delivery (`ALREADY_EXISTS`).  A user
 * without RCS is `NOT_FOUND`, `not-on-channel`, for a fallback to SMS; an
 * agent not launched for the carrier `configuration`.  The receipt says
 * `state: 'accepted'`, the messageId its id.
 *
 * @example
 * ```js
 * const { RbmTransport } = require('@alexify/mailer/rbm');
 * const rbm = new RbmTransport({ serviceAccount, agentId: 'my-agent' });
 * ```
 */
export declare class RbmTransport implements VerifiableTransport<'rbm', RcsMessage> {
  readonly id = 'rbm';
  constructor(config: RbmConfig);
  send(message: RcsMessage, options?: TransportOptions): Promise<Receipt<'rbm'>>;
  sendMany(
    messages: Iterable<RcsMessage> | AsyncIterable<RcsMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'rbm'>>;
  /**
   * Verifies the service account by asking for its token; the agent is checked only by a message.
   */
  verify(options?: TransportOptions): Promise<void>;
}
