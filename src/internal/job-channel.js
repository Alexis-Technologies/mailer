// Not ported: the channel of a run of a job, as a driver or the spans of a
// worker tell it without opening the job: `email` for one of version 1, or
// the channel its data or its name gives (a job of a channel is named by it,
// its channel sealed with its fields).

const { CHANNELS } = require('./channel/channels.js');

/**
 * The channel of a job, or nothing for a job of no channel this package
 * knows, so that no value of a store becomes an attribute or a field.
 *
 * @internal
 */
const channelOfJob = (job) => {
  if (job?.data?.v === 1) return 'email';
  const named = job?.data?.channel ?? job?.name;
  return CHANNELS.has(named) ? named : undefined;
};

module.exports = { channelOfJob };
