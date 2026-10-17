// Not ported: the refusal of a message a transport would have to send at once
// although it asks for later.  unemail refuses an option its driver does not
// take rather than dropping it (src/core/define.ts); a message scheduled for
// tomorrow and sent now is the worse of the two failures.

/**
 * The reason a transport gives for a message it cannot schedule.  "Invalid"
 * makes the receipt a non-retryable validation failure, so `./pool` does not
 * fail over with it and `./retry` does not retry it.
 *
 * @param provider The transport that refuses it.
 * @returns The error message.
 * @internal
 */
const schedulingRefusal = (provider) =>
  `Invalid scheduledAt: ${provider} cannot schedule a message, so it is refused rather than sent at once.`;

/**
 * Refuses a message that asks for a later delivery its transport cannot
 * schedule, before anything is sent.
 *
 * @param message The message.
 * @param provider The transport that would send it.
 * @throws {TypeError} If the message carries `scheduledAt`.
 * @internal
 */
const refuseScheduledAt = (message, provider) => {
  if (message.scheduledAt != null) throw new TypeError(schedulingRefusal(provider));
};

module.exports = { refuseScheduledAt, schedulingRefusal };
