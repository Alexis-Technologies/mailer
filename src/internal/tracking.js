// Not ported: the `tracking` of a message for a provider with one switch for
// open and click tracking together (Azure, Maileroo).

const { RefusalError } = require('./refusal.js');

/**
 * The one switch a message's `tracking` asks for: what it says of opens or of
 * clicks, or `undefined` when it says nothing.
 *
 * @param tracking The `tracking` of the message.
 * @param label The provider's name, for the error.
 * @returns `true`, `false` or `undefined`.
 * @throws {RangeError} If it asks for one kind without the other.
 * @internal
 */
const trackingSwitchOf = (tracking, label) => {
  if (tracking === undefined) return undefined;
  const { opens, clicks } = tracking;
  if (opens !== undefined && clicks !== undefined && opens !== clicks) {
    throw new RefusalError(`${label} turns open and click tracking on or off together.`);
  }
  return opens ?? clicks;
};

module.exports = { trackingSwitchOf };
