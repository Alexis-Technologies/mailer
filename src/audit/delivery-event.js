// Not ported: the delivery events of ./webhooks as states of a message:
// `accepted`, `delivered`, `bounced` and `complained` are states, `rejected`
// is `failed` with nothing sent, `deferred` keeps a message accepted, and an
// open, a click or an unsubscribe is engagement, not a state.

const { toUuid } = require('../internal/uuid.js');

const STATES = new Map([
  ['accepted', 'accepted'],
  ['deferred', 'accepted'],
  ['delivered', 'delivered'],
  ['bounced', 'bounced'],
  ['complained', 'complained'],
  ['rejected', 'failed'],
]);

/**
 * The state of a message a delivery event tells.
 *
 * @param event A delivery event of ./webhooks.
 * @returns The state, or `undefined` for engagement and the unknown.
 */
const stateOfDeliveryEvent = (event) => STATES.get(event?.type);

/**
 * The audit event of a delivery event: its state, found by the
 * `correlationId` the message's metadata gave back, or by the provider's id
 * of the message when it has none.
 *
 * @param event A delivery event of ./webhooks.
 * @param options `now`, when the event says not when it happened.
 * @returns The audit event, or `undefined` when the event tells no state or
 * names no message.
 */
const auditEventOfDeliveryEvent = (event, options = {}) => {
  const state = stateOfDeliveryEvent(event);
  const correlationId = event?.correlationId ?? event?.messageId;
  if (state === undefined || typeof correlationId !== 'string' || correlationId === '') {
    return undefined;
  }
  const occurredAt = event.occurredAt instanceof Date ? event.occurredAt : undefined;
  const at = occurredAt ?? new Date((options.now ?? Date.now)());
  const audit = {
    // The same each time the provider sends the event again.
    id: toUuid(`event\u0000${event.provider}\u0000${event.id}`),
    state,
    at: at.toISOString(),
    source: 'webhook',
    correlationId,
    attempt: 0,
    provider: event.provider,
    deliveryEvent: { type: event.type, id: event.id },
  };
  if (event.messageId !== undefined) audit.providerMessageId = event.messageId;
  if (event.rfcMessageId !== undefined) audit.messageId = event.rfcMessageId;
  if (Array.isArray(event.tags) && event.tags.length > 0) audit.tags = event.tags;
  if (event.bounce !== undefined) audit.deliveryEvent.bounce = event.bounce;
  return audit;
};

module.exports = { auditEventOfDeliveryEvent, stateOfDeliveryEvent };
