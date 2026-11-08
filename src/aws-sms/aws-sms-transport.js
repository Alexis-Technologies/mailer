// Not ported: a transport of SMS over AWS End User Messaging SMS (the API
// pinpoint-sms-voice-v2), the receipt of the message AWS took, its
// `MessageId` the id, whose delivery the events of its configuration set
// tell.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { countSegments } = require('../internal/channel/segments.js');
const { channelFailure } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { createAwsSmsConfig } = require('./config.js');
const { createAwsSmsClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'aws-sms';

/**
 * A transport of SMS over AWS End User Messaging SMS.
 */
class AwsSmsTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createAwsSmsConfig, createAwsSmsClient);
  }

  /**
   * Sends one SMS with SendTextMessage.
   *
   * @param message An SMS.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the MessageId its id, its segments as counted here.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sent) => convertMessage(sent, this.config),
      request: (body, sendOptions) => this.httpClient.call('SendTextMessage', body, sendOptions),
      receiptOf: (answer) => {
        const messageId = answer.json?.MessageId;
        if (typeof messageId !== 'string' || messageId === '') {
          return createFailedReceipt('AWS answered without the MessageId.', {
            provider: PROVIDER,
            channel: 'sms',
            category: 'unknown',
            deliveryUnknown: true,
          });
        }
        // AWS gives no count of the segments; they are counted as a carrier does.
        return {
          successful: true,
          messageId,
          provider: PROVIDER,
          channel: 'sms',
          state: 'accepted',
          segments: countSegments(message.text).segments,
        };
      },
      failureOf: (error) => channelFailure(PROVIDER, 'sms', error),
    });
  }

  /**
   * Checks the credentials and the region by describing the configuration
   * sets of the account, which reads and sends nothing.
   *
   * @param options Optional abort signal.
   * @throws {Error} If AWS refuses the credentials.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    await this.httpClient.call(
      'DescribeConfigurationSets',
      { MaxResults: 1 },
      {
        signal: options?.signal,
        isIdempotent: true,
      },
    );
  }
}

module.exports = { AwsSmsTransport };
