// Not ported: the recipient of a message of a channel as one string, for what
// finds it (./mock) or keeps it out of a record: its number or id, or the
// token, topic, endpoint or conversation its object names.

/**
 * The recipient a `to` names, as a string.
 *
 * @returns Its number or id, or the token, topic, endpoint or conversation
 * of its object; `undefined` for a message without one.
 * @internal
 */
const recipientOf = (to) => {
  if (typeof to !== 'object' || to === null) return to === undefined ? undefined : String(to);
  return to.token ?? to.topic ?? to.endpoint ?? to.conversationId;
};

module.exports = { recipientOf };
