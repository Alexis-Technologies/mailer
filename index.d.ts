/**
 * A mailer: sends messages through a transport, with the reliability layer
 * (queue, audit log, delivery events) on top.
 *
 * Provisional: the shape is defined with the Phase 0 contracts.
 */
export interface Mailer {
  send(message: object): Promise<unknown>;
}

/**
 * Creates a mailer.
 *
 * Placeholder: throws until the mailer is implemented. The signature is
 * provisional.
 */
export function createMailer(options: object): Mailer;
