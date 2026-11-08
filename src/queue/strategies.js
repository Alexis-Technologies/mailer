// Not ported: the strategy of each kind of job, by which the one core of the
// queue makes, reads and sends it: an email job (version 1, that of 1.2) or
// a job of another channel (version 2).

const { CHANNELS } = require('../internal/channel/channels.js');
const { channelJob } = require('./channel-job.js');
const { emailJob } = require('./email-job.js');

/**
 * The strategy of the input of a job: email unless it names another channel.
 *
 * @throws {TypeError} If it names a channel there is none of.
 * @internal
 */
const strategyOfInput = (input) => {
  const { channel } = input;
  if (channel === undefined || channel === 'email') return emailJob;
  if (!CHANNELS.has(channel)) throw new TypeError(`Unknown channel: ${JSON.stringify(channel)}.`);
  return channelJob;
};

/**
 * The strategy of the data of a job by its version, or nothing for a
 * version this package does not write.
 *
 * @internal
 */
const strategyOfData = (data) => {
  if (data.v === emailJob.version) return emailJob;
  return data.v === channelJob.version ? channelJob : undefined;
};

/** The latest version of a job this package reads. */
const LATEST_VERSION = channelJob.version;

module.exports = { LATEST_VERSION, strategyOfData, strategyOfInput };
