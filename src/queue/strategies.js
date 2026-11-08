// Not ported: the strategy of each kind of job, by which the one core of the
// queue makes, reads and sends it: an email job (version 1, that of 1.2).

const { emailJob } = require('./email-job.js');

/**
 * The strategy of the input of a job.
 *
 * @internal
 */
const strategyOfInput = () => emailJob;

/**
 * The strategy of the data of a job by its version, or nothing for a
 * version this package does not write.
 *
 * @internal
 */
const strategyOfData = (data) => (data.v === emailJob.version ? emailJob : undefined);

/** The latest version of a job this package reads. */
const LATEST_VERSION = emailJob.version;

module.exports = { LATEST_VERSION, strategyOfData, strategyOfInput };
