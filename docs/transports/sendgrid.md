# SendGrid

[SendGrid] is a comprehensive cloud-based email delivery platform that provides
reliable email infrastructure for businesses of all sizes. It offers powerful
APIs for sending transactional and marketing emails, with advanced features
including email templates, A/B testing, real-time analytics, and sophisticated
deliverability tools. SendGrid is particularly well-suited for transactional
emails such as account verification, password resets, order confirmations,
and automated notifications.

@alexify/mailer provides a feature-rich SendGrid transport through the *@alexify/mailer/sendgrid*
package, supporting all major SendGrid features including tracking, templates,
personalization, and bulk sending with comprehensive error handling and retry
logic.

[SendGrid]: https://sendgrid.com/

## Installation

To use the SendGrid transport, you need to install the *@alexify/mailer/sendgrid* subpath:

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Getting started

Before using the SendGrid transport, you'll need a SendGrid account and an API
key. SendGrid provides API keys through their web interface under *Settings* →
*API Keys*, where you can create keys with specific permissions for your
application's needs.

```js
const { SendGridTransport } = require('@alexify/mailer/sendgrid');
const { createMessage } = require('@alexify/mailer');

const transport = new SendGridTransport({
  apiKey: 'SG.1234567890abcdef.1234567890abcdef1234567890abcdef12345678',
});

const message = createMessage({
  from: 'support@example.com',
  to: 'customer@example.com',
  subject: 'Welcome to our service',
  content: { text: 'Thank you for signing up!' },
});

const receipt = await transport.send(message);
if (receipt.successful) {
  console.log('Message sent with ID:', receipt.messageId);
} else {
  console.error('Send failed:', receipt.errorMessages.join(', '));
}
```

The SendGrid transport handles authentication automatically using your API key
and sends emails through SendGrid's robust infrastructure. The service manages
bounces, spam filtering, and delivery optimization automatically, providing
excellent deliverability rates.

## Email tracking and analytics

SendGrid provides comprehensive email tracking and analytics capabilities.
The transport enables tracking by default, but you can customize tracking
behavior to match your privacy requirements and analytics needs:

```js
const { SendGridTransport } = require('@alexify/mailer/sendgrid');

const transport = new SendGridTransport({
  apiKey: 'SG.1234567890abcdef.1234567890abcdef1234567890abcdef12345678',
  clickTracking: true,
  openTracking: true,
  subscriptionTracking: false,
  googleAnalytics: false,
});
```

With tracking enabled, SendGrid provides detailed analytics about email
delivery, opens, clicks, unsubscribes, and bounces through their dashboard
and webhooks. This data is essential for monitoring email campaign performance
and improving engagement rates.

## Message tagging and organization

SendGrid allows you to tag messages for better organization and analytics.
Tags help you categorize emails and track performance across different types
of messages and campaigns:

```js
const { SendGridTransport } = require('@alexify/mailer/sendgrid');
const { createMessage } = require('@alexify/mailer');

const transport = new SendGridTransport({
  apiKey: 'SG.1234567890abcdef.1234567890abcdef1234567890abcdef12345678',
});

const welcomeMessage = createMessage({
  from: 'onboarding@example.com',
  to: 'newuser@example.com',
  subject: 'Welcome to our platform',
  content: {
    html: '<h1>Welcome!</h1><p>Thank you for joining us.</p>',
    text: 'Welcome! Thank you for joining us.',
  },
  tags: ['onboarding', 'welcome', 'transactional'],
});

const receipt = await transport.send(welcomeMessage);
```

Tags appear in SendGrid's analytics dashboard and can be used with webhooks,
allowing you to track open rates, click rates, and delivery statistics for
specific message categories. This helps you understand which types of emails
perform best with your audience.

## Bulk email sending

For sending newsletters, notifications, or other bulk emails, the SendGrid
transport provides efficient batch processing with automatic retry logic
and comprehensive error handling:

```js
const { SendGridTransport } = require('@alexify/mailer/sendgrid');
const { createMessage } = require('@alexify/mailer');

const transport = new SendGridTransport({
  apiKey: "SG.1234567890abcdef.1234567890abcdef1234567890abcdef12345678",
  retries: 3,
  timeout: 30000,
});

const subscribers = [
  "user1@example.com",
  "user2@example.com",
  "user3@example.com",
];

const messages = subscribers.map(email =>
  createMessage({
    from: "newsletter@example.com",
    to: email,
    subject: "Monthly Newsletter - December 2024",
    content: {
      html: "<h2>This Month's Updates</h2><p>Here's what's new...</p>",
      text: "This Month's Updates\n\nHere's what's new...",
    },
    tags: ["newsletter", "monthly"],
  })
);

for await (const receipt of transport.sendMany(messages)) {
  if (receipt.successful) {
    console.log(`Newsletter sent to ${receipt.messageId}`);
  } else {
    console.error(`Failed to send: ${receipt.errorMessages.join(", ")}`);
  }
}
```

The `SendGridTransport.sendMany()` method processes emails one after the other
with built-in retry logic. Failed emails don't prevent subsequent emails from
being sent, and detailed error information helps you identify and resolve
delivery issues quickly.

With `concurrency` set (1 by default), it sends that many messages at once: it
reads a message only when a send can start, so a long iterable costs that many
messages of memory, and gives the receipts in the order of the messages.

```js
const transport = new SendGridTransport({
  apiKey: process.env.SENDGRID_API_KEY,
  concurrency: 4,
});
```

## Advanced configuration and reliability

The SendGrid transport includes comprehensive configuration options for timeout
handling, retry behavior, SSL validation, and custom headers to ensure reliable
email delivery in production environments:

```js
const { SendGridTransport } = require('@alexify/mailer/sendgrid');

const transport = new SendGridTransport({
  apiKey: 'SG.1234567890abcdef.1234567890abcdef1234567890abcdef12345678',
  baseUrl: 'https://api.sendgrid.com/v3',
  timeout: 15000,
  retries: 5,
  validateSsl: true,
  headers: {
    'X-Custom-Header': 'MyApp-v1.0',
    'X-Environment': 'production',
  },
  clickTracking: true,
  openTracking: true,
  subscriptionTracking: false,
  googleAnalytics: true,
});
```

Timeout settings control how long to wait for SendGrid's API responses,
while retry configuration determines how many times to retry failed requests.
The transport uses exponential backoff for retries, reducing load on SendGrid's
servers during temporary outages and improving overall reliability.


## Scheduling, metadata and tracking

`scheduledAt` is SendGrid's `send_at`, at most 72 hours ahead (the `now` option
is the clock it is measured by); a later one is refused before the request.
`metadata` is `custom_args`, which SendGrid returns in its events. A message's
`tracking` sets its open and click tracking over `openTracking` and
`clickTracking` of the configuration.

```js
const receipt = await transport.send(
  createMessage({
    from: 'shop@example.com',
    to: 'user@example.com',
    subject: 'Your order has shipped',
    content: { html: '<p>On its way.</p>' },
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
    tracking: { opens: false },
    metadata: { orderId: '42' },
  }),
);
```

## Verifying the configuration

`verify()` reads the scopes of the API key (`GET /v3/scopes`) and checks that one
of them is `mail.send`, so a restricted key that may not send fails before the
first message.  It throws an error with the `statusCode` of the answer when
SendGrid refuses the key.

## Development and testing

For development and testing, you can configure the SendGrid transport for
testing environments or use SendGrid's sandbox mode. SendGrid doesn't provide
dedicated sandbox domains like some providers, but you can use test API keys
and monitor emails through their Event Webhook for testing:

```js
const { SendGridTransport } = require('@alexify/mailer/sendgrid');

// Development configuration with reduced timeouts
const devTransport = new SendGridTransport({
  apiKey: 'SG.test1234567890ab.cdef1234567890abcdef1234567890abcdef123456',
  timeout: 5000, // Shorter timeout for development
  retries: 1, // Fewer retries for faster feedback
  clickTracking: false,
  openTracking: false,
});

// Testing configuration with environment variables
const testTransport = new SendGridTransport({
  apiKey: process.env.SENDGRID_TEST_API_KEY ?? 'SG.test123',
  timeout: 10000,
  retries: 1, // Fewer retries for faster test execution
  clickTracking: false, // Disable tracking in tests
  openTracking: false,
  subscriptionTracking: false,
});
```

For testing, consider using restricted API keys that can only send to verified
email addresses or specific domains. This prevents accidental email sends to
real users during development while still allowing you to test the complete
email sending workflow.

> [!TIP]
> SendGrid provides excellent testing tools through their Event Webhook feature.
> You can configure webhooks to receive real-time notifications about email
> events (delivered, opened, clicked, etc.) which is invaluable for testing
> email flows and debugging delivery issues in development environments.

> [!CAUTION]
> Unlike some email providers, SendGrid doesn't have a true sandbox mode that
> prevents email delivery. Always use test API keys with restricted permissions
> and verified recipient addresses during development to avoid sending test
> emails to real users. Consider using services like [MailHog] or [Mailpit]
> for local development testing.

[MailHog]: https://github.com/mailhog/MailHog
[Mailpit]: https://github.com/axllent/mailpit
