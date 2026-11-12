# AWS End User Messaging SMS

`@alexify/mailer/aws-sms` sends SMS through
[AWS End User Messaging SMS](https://docs.aws.amazon.com/sms-voice/latest/userguide/what-is-sms-mms.html)
(`SendTextMessage` of the API `pinpoint-sms-voice-v2`, which Amazon Pinpoint's
SMS moved to), each attempt signed with SigV4, as `./ses` signs its requests.

```js
const { AwsSmsTransport } = require('@alexify/mailer/aws-sms');
const { createChannelMessage } = require('@alexify/mailer/channels');

const sms = new AwsSmsTransport({
  credentials: { accessKeyId, secretAccessKey }, // or () => credentials of a role
  region: 'eu-west-1',
  originationIdentity: 'MyBrand', // a number, a sender id or a pool
  configurationSetName: 'transactional', // whose event destinations tell the deliveries
});

await sms.send(
  createChannelMessage({
    channel: 'sms',
    to: '+380671234567',
    text: `Your code is ${code}`,
    priority: 'high',
    expiresAt: new Date(Date.now() + 5 * 60_000),
    metadata: { correlationId: login.id },
  }),
);
// { successful: true, messageId: '…', provider: 'aws-sms', channel: 'sms',
//   state: 'accepted', segments: 1 }
```

`credentials` may be a function, called at each attempt, such as a provider of
`@aws-sdk/credential-providers` for the credentials of a role, which it renews:
the package takes none of the SDK itself.

## What goes

| Message | `SendTextMessage` |
| --- | --- |
| `to` | `DestinationPhoneNumber` |
| `from`, or none | `OriginationIdentity`, else `originationIdentity` |
| `text` | `MessageBody`, 1600 characters at most |
| `priority` | `MessageType`: `high` transactional, `low` promotional, `normal` the transport's `messageType` |
| `expiresAt` | `TimeToLive`, five seconds to three days |
| `metadata` | `Context`, five keys, `correlationId` first, which the events give back |
| `payload` | the fields of the body over those (`MaxPrice`, `ProtectConfigurationId`, `DryRun`), but the number and the text |

An MMS (which goes through `SendMediaMessage`), buttons and a text of more than
1600 characters are refused before any request.

## Receipts

The receipt says `state: 'accepted'`, the `MessageId` its id; AWS gives no
count of the parts, so its `segments` are those `countSegments` of
[`./channels`](/channels/messages) counts, as a carrier does.

| Error | Category |
| --- | --- |
| `DESTINATION_PHONE_NUMBER_OPTED_OUT` | `opted-out` |
| `INVALID_PHONE_NUMBER` | `invalid-recipient` |
| `DESTINATION_PHONE_NUMBER_NOT_VERIFIED` (the sandbox), `DESTINATION_COUNTRY_BLOCKED`, `MONTHLY_SPEND_LIMIT_REACHED_FOR_TEXT`, `ResourceNotFoundException` | `configuration` |
| `AccessDeniedException`, `UnrecognizedClientException`, `InvalidSignatureException` | `auth` |
| `ThrottlingException`, `ServiceQuotaExceededException` | `rate-limit`, retried |
| `InternalServerException`, a 500 or a 502 | of unknown delivery |
| `ServiceUnavailableException`, a 503 | `server-error`, retried |
| another `ValidationException` | `validation` |

`SendTextMessage` takes no idempotency key: a send whose answer was lost, or was
a 500 or a 502, is never retried, and its receipt is `deliveryUnknown`.

`verify()` describes the configuration sets of the account, which sends
nothing; a key that may only send, refused that read, is verified.
