// Not ported: the names of the channels other than email, which the builder
// of their messages and ./router share without the rest of either.

/**
 * The channels other than email.
 *
 * @internal
 */
const CHANNELS = new Set([
  'sms',
  'rcs',
  'whatsapp',
  'messenger',
  'instagram',
  'telegram',
  'viber',
  'slack',
  'discord',
  'teams',
  'google-chat',
  'push',
]);

module.exports = { CHANNELS };
