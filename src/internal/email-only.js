// Not ported: the refusal of a message of a channel by a transport of email,
// apart from internal/refusal.js, so that the transports of the channels,
// which share that module, carry none of it.

const { RefusalError } = require('./refusal.js');

/**
 * Refuses a message of a channel given to a transport of email, through a
 * queue shared with the channels or a router or pool set up wrong, before a
 * field it has not is read: as a transport of a channel refuses an email.
 *
 * @param message The message.
 * @param label The name of the transport.
 * @throws {RefusalError} If the message is of a channel other than email.
 * @internal
 */
const checkEmailMessage = (message, label) => {
  const channel = message?.channel;
  if (channel !== undefined && channel !== 'email') {
    throw new RefusalError(`${label} sends email, not messages of ${channel}.`);
  }
};

module.exports = { checkEmailMessage };
