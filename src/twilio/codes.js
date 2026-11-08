// Not ported: what the error codes of Twilio say
// (https://www.twilio.com/docs/api/errors), as categories of a receipt: of
// the request of a message, and of its delivery, which `./webhooks/twilio`
// reads of a status callback with the same table. thinwrap made a STOP
// (21610) and a region not enabled (21408) invalid recipients alike (T6).

const CODES = new Map([
  [21610, 'opted-out'],
  [21211, 'invalid-recipient'],
  [21601, 'invalid-recipient'],
  [21614, 'invalid-recipient'],
  [30005, 'invalid-recipient'],
  [30006, 'invalid-recipient'],
  [30003, 'unreachable'],
  [30008, 'unreachable'],
  [63003, 'not-on-channel'],
  [63016, 'outside-window'],
  [30004, 'blocked'],
  [30007, 'rejected'],
  [20003, 'auth'],
  [20404, 'configuration'],
  [21408, 'configuration'],
  [21606, 'configuration'],
  // The pair of To and From cannot carry a message: a sender, a country or a
  // carrier, which no retry changes.
  [21612, 'configuration'],
  [21212, 'configuration'],
  [21659, 'configuration'],
  [63007, 'configuration'],
  [21602, 'validation'],
  [21617, 'validation'],
  [21620, 'validation'],
  [21623, 'validation'],
  [63013, 'validation'],
  [20429, 'rate-limit'],
  [14107, 'rate-limit'],
  [30022, 'rate-limit'],
]);

/**
 * The category of an error code of Twilio, or nothing for one it does not
 * name.
 *
 * @internal
 */
const categoryOfCode = (code) => CODES.get(code);

module.exports = { categoryOfCode };
