// Not ported: the strategy of a job of a channel other than email, version
// 2: its fields checked by `createChannelMessage` when it is enqueued, its
// recipient in E.164 then for a phone; its media kept in the job in base64,
// bounded, or as a reference the worker resolves; its id derived from its
// key and its channel, so that an SMS and an email under one key are two
// jobs; its channel sealed with the rest of its fields by a codec, never in
// the envelope, which a worker of 1.2 refuses a field of.

const { CHANNELS } = require('../internal/channel/channels.js');
const { callingCodeOf } = require('../internal/channel/calling-codes.js');
const { createChannelMessage } = require('../internal/channel/message.js');
const { QueueError, invalidJob: invalid } = require('./errors.js');
const { isContent, isObject, isText, storeBytes } = require('./stored.js');

const CHANNEL_JOB_VERSION = 2;
// The fields of a job of version 2, as V1_KEYS are those of an email job.
const V2_KEYS = new Set([
  'v',
  'channel',
  'kind',
  'template',
  'context',
  'locale',
  'to',
  'from',
  'text',
  'media',
  'buttons',
  'payload',
  'mentions',
  'providerTemplate',
  'thread',
  'title',
  'data',
  'priority',
  'tags',
  'metadata',
  'idempotencyKey',
  'tenantId',
  'correlationId',
  'notBefore',
  'expiresAt',
  'enqueuedAt',
  'hash',
  'mac',
  'kid',
  'trace',
]);
// The fields of an input that are the job's, which the core reads, rather
// than the message's, which `createChannelMessage` checks.
const JOB_FIELDS = new Set([
  'kind',
  'template',
  'context',
  'locale',
  'providerTemplate',
  'media',
  'metadata',
  'idempotencyKey',
  'tenantId',
  'correlationId',
  'maxAttempts',
  'scheduledAt',
  'expiresAt',
]);
// What a medium is told by beside its content or reference.
const PART_FIELDS = ['url', 'id', 'contentType', 'filename', 'caption'];
const MAX_REF_LENGTH = 2048;
const EMPTY = new Uint8Array(0);

/**
 * Checks the country a phone number written without its calling code is of.
 *
 * @throws {TypeError} If it is not the ISO 3166-1 alpha-2 code of one.
 * @internal
 */
const checkDefaultCountry = (country) => {
  if (country !== undefined && callingCodeOf(country) === undefined) {
    throw new TypeError(`defaultCountry is no country: ${JSON.stringify(country)}.`);
  }
};

// The media of a job: their bytes or a reference kept, and the stand-ins
// `createChannelMessage` checks them by.
const prepareMedia = (given, config) => {
  if (given === undefined) return { kept: undefined, probes: undefined };
  if (!Array.isArray(given)) throw new TypeError('media must be an array.');
  const kept = [];
  const probes = [];
  const counter = { bytes: 0 };
  for (const medium of given) {
    if (!isObject(medium)) {
      throw new TypeError('A medium of a job is { url }, { id }, { content } or { ref }.');
    }
    const probe = { ...medium };
    if (medium.ref !== undefined) {
      if (!isText(medium.ref, MAX_REF_LENGTH) || medium.content !== undefined) {
        throw new TypeError('The ref of a medium of a job is a string, without content.');
      }
      delete probe.ref;
      probe.content = EMPTY;
      kept.push({ ref: medium.ref });
    } else if (medium.content !== undefined) {
      if (!(medium.content instanceof Uint8Array)) {
        throw new TypeError('A medium of a job holds bytes; give a Blob or a stream as { ref }.');
      }
      probe.content = EMPTY;
      kept.push({ data: storeBytes(medium.content, counter, config, 'media') });
    } else {
      kept.push(undefined);
    }
    probes.push(probe);
  }
  return { kept, probes };
};

// The media as the job holds them: a URL or an id as checked, bytes or a
// reference with what checked them.
const mediaOf = (kept, checked) => {
  const media = [];
  for (let index = 0; index < checked.length; index++) {
    const medium = checked[index];
    const stored = kept[index];
    if (stored === undefined) {
      media.push(medium);
      continue;
    }
    for (const name of PART_FIELDS) {
      if (medium[name] !== undefined) stored[name] = medium[name];
    }
    media.push(stored);
  }
  return media;
};

// The fields of the message as `createChannelMessage` checked them, as JSON.
const fieldsOf = (input, probe, media) => {
  const fields = {};
  if (probe.to !== undefined) fields.to = probe.to;
  if (probe.from !== undefined) fields.from = probe.from;
  if (input.kind === 'content' && probe.text !== undefined) fields.text = probe.text;
  if (media !== undefined && media.length > 0) fields.media = media;
  if (probe.buttons !== undefined) fields.buttons = probe.buttons;
  if (probe.payload !== undefined) fields.payload = probe.payload;
  if (probe.mentions !== undefined) fields.mentions = probe.mentions;
  if (probe.template !== undefined) fields.providerTemplate = probe.template;
  if (probe.thread !== undefined) fields.thread = probe.thread;
  if (probe.title !== undefined) fields.title = probe.title;
  if (probe.data !== undefined) fields.data = { ...probe.data };
  fields.priority = probe.priority;
  if (probe.tags.length > 0) fields.tags = [...probe.tags];
  fields.metadata = { ...probe.metadata };
  return fields;
};

const checkMedia = (media) => {
  if (media === undefined) return;
  if (!Array.isArray(media)) throw invalid('media is no list.');
  for (const medium of media) {
    const sources =
      (typeof medium?.data === 'string' ? 1 : 0) +
      (typeof medium?.ref === 'string' ? 1 : 0) +
      (typeof medium?.url === 'string' ? 1 : 0) +
      (typeof medium?.id === 'string' ? 1 : 0);
    if (!isObject(medium) || sources !== 1) {
      throw invalid('a medium is not { url }, { id }, or { data | ref, contentType }.');
    }
  }
};

/**
 * The strategy of a job of a channel.
 *
 * @internal
 */
const channelJob = {
  version: CHANNEL_JOB_VERSION,
  keys: V2_KEYS,
  strings: ['from', 'text', 'thread', 'title'],
  required: [],
  part: 'medium',

  // The channel ends the seed, so that the jobs of one key on two channels
  // are two jobs, and an email job keeps the seed of 1.2.
  seedOf: (scoped, input) => `${scoped}\u0000${input.channel}`,

  contentBodyOf: () => ({ kind: 'content' }),

  /**
   * The fields of the message of a job, checked as `createChannelMessage`
   * checks them.
   *
   * @param input The input of the job.
   * @param context `config` and the `correlationId`.
   * @returns `{ head, fields, priority }`.
   */
  prepare(input, context) {
    const { config, correlationId } = context;
    if (input.providerTemplate !== undefined && input.channel !== 'whatsapp') {
      throw new TypeError(`A job of ${input.channel} takes no providerTemplate.`);
    }
    const probeInput = {};
    for (const key in input) {
      if (Object.hasOwn(input, key) && !JOB_FIELDS.has(key)) probeInput[key] = input[key];
    }
    if (input.kind === 'template') {
      if (input.text !== undefined) {
        throw new TypeError('A template job renders its text: it takes none.');
      }
      probeInput.text = '';
    }
    const { kept, probes } = prepareMedia(input.media, config);
    probeInput.media = probes;
    probeInput.template = input.providerTemplate;
    probeInput.metadata = { ...input.metadata, correlationId };
    const probe = createChannelMessage(probeInput, { defaultCountry: config.defaultCountry });
    const media = kept === undefined ? undefined : mediaOf(kept, probe.media);
    return {
      head: { channel: probe.channel },
      fields: fieldsOf(input, probe, media),
      priority: probe.priority,
    };
  },

  // A job of a channel is named by it, which a dashboard of the driver
  // shows, and which a span reads of a sealed one.
  nameOf: (data) => data.channel,

  describe: (data) => ({ channel: data.channel }),

  check(data) {
    if (typeof data.channel !== 'string' || data.channel === 'email') {
      throw invalid(`its channel is ${JSON.stringify(data.channel)}.`);
    }
    // A channel of a later version waits for its worker.
    if (!CHANNELS.has(data.channel)) {
      throw new QueueError(
        'queue.unsupported_version',
        `The job is of the channel ${JSON.stringify(data.channel)}, which this worker does not send.`,
      );
    }
    checkMedia(data.media);
  },

  contentOf: (data) => ({ text: data.text, title: data.title }),

  // A template renders the text of a message of a channel, from its HTML
  // when it gives none; the subject of a template is the title of a push
  // that has none.
  renderedOf(data, fields) {
    const text = fields.content.text;
    if (typeof text !== 'string' || text === '') {
      return {
        failure: {
          code: 'render.no_text',
          reason: `The template ${data.template} gave no text.`,
        },
      };
    }
    if (data.channel !== 'push') return { fields: { text } };
    return { fields: { text, title: data.title ?? fields.subject } };
  },

  partsOf: (data) => data.media,

  partFieldsOf(stored) {
    const fields = {};
    for (const name of PART_FIELDS) {
      if (stored[name] !== undefined) fields[name] = stored[name];
    }
    return fields;
  },

  describePart: (fields) =>
    fields.filename === undefined
      ? `a medium of ${fields.contentType}`
      : `the medium ${fields.filename}`,

  /** The medium of a resolver's answer: its content, or a medium with content or a URL. */
  resolvedOf(fields, resolved) {
    if (isContent(resolved)) return { ...fields, content: resolved };
    if (isContent(resolved?.content)) return { ...fields, content: resolved.content };
    if (typeof resolved?.url === 'string') return { ...fields, url: resolved.url };
    return undefined;
  },

  build: (data, fields, parts, job) =>
    createChannelMessage({
      channel: data.channel,
      to: data.to,
      from: data.from,
      text: fields.text,
      media: data.media === undefined ? undefined : parts,
      buttons: data.buttons,
      payload: data.payload,
      mentions: data.mentions,
      template: data.providerTemplate,
      thread: data.thread,
      title: fields.title,
      data: data.data,
      tags: data.tags,
      priority: data.priority,
      metadata: data.metadata,
      tenantId: data.tenantId,
      // As for email: the job's id, scoped to its tenant and channel.
      idempotencyKey: job.id,
      expiresAt: data.expiresAt === undefined ? undefined : new Date(data.expiresAt),
    }),
};

module.exports = { CHANNEL_JOB_VERSION, channelJob, checkDefaultCountry };
