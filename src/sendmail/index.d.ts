// Types ported from nodemailer v10.0.16 (src/sendmail-transport)
// https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman

import type {
  IdGenerator,
  Logger,
  Message,
  RawMessage,
  RawTransport,
  Receipt,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';
import type { DkimConfig } from '../mime/index.js';

/**
 * A child process as `spawn` gives it: the pipes the transport writes the
 * message to and reads stderr from, its events and `kill`.
 */
export interface SendmailProcess {
  readonly stdin: {
    write(chunk: Uint8Array): boolean;
    end(chunk?: Uint8Array): unknown;
    readonly destroyed: boolean;
    on(event: string, listener: (...args: any[]) => void): unknown;
    once(event: string, listener: (...args: any[]) => void): unknown;
  } | null;
  readonly stderr: { on(event: 'data', listener: (chunk: Uint8Array) => void): unknown } | null;
  once(event: 'error', listener: (error: Error & { code?: string }) => void): unknown;
  once(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal?: string): boolean;
}

/**
 * The options of {@link SendmailTransport}.
 */
export interface SendmailConfig {
  /**
   * The command: a path, or a name looked up on PATH.
   * @default "sendmail"
   */
  readonly path?: string;
  /**
   * Arguments in place of `-f <sender>`: the transport runs
   * `<path> -i <args…> -- <recipients…>`.  By default it passes the sender of
   * the envelope with `-f` (`-f <>` for none).
   */
  readonly args?: readonly string[];
  /**
   * The line endings the message is written with: `lf`, which every sendmail
   * takes, or `crlf`.
   * @default "lf"
   */
  readonly newline?: 'lf' | 'crlf';
  /**
   * Starts the process, `child_process.spawn` by default: pass your own to run
   * sendmail in a container or under another user.
   */
  readonly spawn?: (
    command: string,
    args: readonly string[],
    options: { stdio: ['pipe', 'ignore', 'pipe']; windowsHide: boolean },
  ) => SendmailProcess;
  /** Signs each message, as `./mime` and `./smtp` do. */
  readonly dkim?: DkimConfig;
  /** Makes the left half of a Message-ID, and the id of a raw receipt. */
  readonly generateId?: IdGenerator;
  /** A pino-like logger for the start and the exit of each process. */
  readonly logger?: Logger;
}

/**
 * A transport that pipes each message to the sendmail command of the system
 * (Postfix, Exim, sendmail, msmtp, …), one process per message.
 *
 * @example
 * ```js
 * const { SendmailTransport } = require('@alexify/mailer/sendmail');
 * const transport = new SendmailTransport({ path: '/usr/sbin/sendmail' });
 * const receipt = await transport.send(message);
 * ```
 */
export declare class SendmailTransport
  implements RawTransport<'sendmail'>, VerifiableTransport<'sendmail'>
{
  readonly id = 'sendmail';
  constructor(config?: SendmailConfig);
  send(message: Message, options?: TransportOptions): Promise<Receipt<'sendmail'>>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'sendmail'>>;
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<Receipt<'sendmail'>>;
  verify(options?: TransportOptions): Promise<void>;
}
