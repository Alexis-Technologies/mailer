# OpenTelemetry

[OpenTelemetry] is the leading open source observability framework for
cloud-native software, providing comprehensive standards for collecting,
processing, and exporting telemetry data including traces, metrics, and logs.
OpenTelemetry enables you to instrument your applications with vendor-neutral
observability, allowing you to monitor performance, track distributed requests,
and analyze system behavior across different environments and observability
backends.

@alexify/mailer provides seamless OpenTelemetry integration through the
*@alexify/mailer/otel* subpath, which acts as a decorator around any existing
email transport to add automatic tracing and metrics collection without
requiring code changes. This zero-configuration observability makes it easy to
monitor email delivery performance, track failures, and analyze usage patterns
across your application.

> [!TIP]
> The OpenTelemetry transport is a decorator that wraps existing transports,
> meaning you can add observability to any @alexify/mailer transport (SMTP, Mailgun,
> SendGrid, etc.) by simply wrapping it with the OpenTelemetry transport.
> This approach preserves all existing functionality while adding comprehensive
> monitoring capabilities.

[OpenTelemetry]: https://opentelemetry.io/

## Installation

The transport is the *@alexify/mailer/otel* subpath. @alexify/mailer does not
require the OpenTelemetry API: the application sets OpenTelemetry up and passes
its tracer and meter providers in, so install the API (and an SDK) next to it:

```bash
pnpm add @alexify/mailer @opentelemetry/api
# or
npm install @alexify/mailer @opentelemetry/api
```

## Basic usage

The OpenTelemetry transport wraps any existing @alexify/mailer transport to add automatic
observability.  You'll typically create your base transport first, then wrap
it with the OpenTelemetry transport to enable monitoring:

```js
const { trace, metrics } = require('@opentelemetry/api');
const { createMessage } = require('@alexify/mailer');
const { MailgunTransport } = require('@alexify/mailer/mailgun');
const { OpenTelemetryTransport } = require('@alexify/mailer/otel');

// Create your base transport
const baseTransport = new MailgunTransport({
  apiKey: 'your-mailgun-api-key',
  domain: 'mg.example.com',
  region: 'us',
});

// Wrap with OpenTelemetry observability
const transport = new OpenTelemetryTransport(baseTransport, {
  tracerProvider: trace.getTracerProvider(),
  meterProvider: metrics.getMeterProvider(),
  metrics: { enabled: true },
  tracing: { enabled: true },
});

const message = createMessage({
  from: 'system@example.com',
  to: 'user@example.com',
  subject: 'Account Created',
  content: { text: 'Welcome to our platform!' },
});

const receipt = await transport.send(message);
if (receipt.successful) {
  console.log('Message sent with ID:', receipt.messageId);
} else {
  console.error('Send failed:', receipt.errorMessages.join(', '));
}

// Clean up resources when done
await transport[Symbol.asyncDispose]();
```

The wrapped transport behaves identically to the base transport while
automatically generating traces and metrics for every email operation.
These telemetry data points are sent to your configured OpenTelemetry backend
for analysis and monitoring.

## Simplified setup

The factory function takes the same configuration as the constructor:

```js
const { trace, metrics } = require('@opentelemetry/api');
const { createOpenTelemetryTransport } = require('@alexify/mailer/otel');
const { SmtpTransport } = require('@alexify/mailer/smtp');

const baseTransport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'smtp-user@example.com',
    pass: 'smtp-password',
  },
});

const transport = createOpenTelemetryTransport(baseTransport, {
  tracerProvider: trace.getTracerProvider(),
  meterProvider: metrics.getMeterProvider(),
  metrics: {
    enabled: true,
    prefix: 'myapp',
  },
  tracing: {
    enabled: true,
    recordSensitiveData: false,
  },
});
```

The providers are always passed in, while tracing or metrics are enabled: there
is no fallback to the global providers of `@opentelemetry/api`, since this
package does not require it.  Pass `trace.getTracerProvider()` and
`metrics.getMeterProvider()` for the global ones, or providers of your own as
below.  Exporters and resource attributes such as `service.name` are set up with
the SDK that builds those providers, so the `auto`, `serviceName` and
`serviceVersion` options of upyo throw a `TypeError` here.

## Using existing providers

If your application already has OpenTelemetry configured with custom providers,
you can pass them directly to the transport configuration. This is the most
common pattern in production applications where observability is set up
at the application level:

```js
const { Resource } = require('@opentelemetry/resources');
const { MeterProvider } = require('@opentelemetry/sdk-metrics');
const { BasicTracerProvider } = require('@opentelemetry/sdk-trace-base');
const {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} = require('@opentelemetry/semantic-conventions');
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { createOpenTelemetryTransport, OpenTelemetryTransport } = require('@alexify/mailer/otel');

// Your application's existing OpenTelemetry setup
const tracerProvider = new BasicTracerProvider({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: 'my-application',
    [SEMRESATTRS_SERVICE_VERSION]: '1.0.0',
  }),
});

const meterProvider = new MeterProvider({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: 'my-application',
    [SEMRESATTRS_SERVICE_VERSION]: '1.0.0',
  }),
});

// Use your existing providers with the email transport
const transport = createOpenTelemetryTransport(
  new SmtpTransport({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'user', pass: 'password' },
  }),
  {
    tracerProvider, // Use your existing tracer provider
    meterProvider, // Use your existing meter provider
    tracing: {
      enabled: true,
      recordSensitiveData: false,
    },
    metrics: {
      enabled: true,
      prefix: 'myapp', // Custom prefix to match your naming convention
    },
  },
);

// Alternatively, use the class constructor directly
const directTransport = new OpenTelemetryTransport(
  new SmtpTransport({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'user', pass: 'password' },
  }),
  {
    tracerProvider, // Your existing providers
    meterProvider,
    tracing: { enabled: true, recordSensitiveData: false },
    metrics: { enabled: true, prefix: 'myapp' },
  },
);
```

This approach ensures that email telemetry data appears alongside other
application telemetry in your existing observability infrastructure,
maintaining consistent resource attributes and following your established
naming conventions.

## Automatic resource management

This and the following examples take `tracerProvider` and `meterProvider`
from your OpenTelemetry setup, such as `trace.getTracerProvider()` and
`metrics.getMeterProvider()` of `@opentelemetry/api`.

The OpenTelemetry transport supports automatic resource cleanup using
the `await using` statement, which ensures proper disposal of both
the observability components and the wrapped transport:

```js
const { createOpenTelemetryTransport } = require('@alexify/mailer/otel');
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { createMessage } = require('@alexify/mailer');

await using transport = createOpenTelemetryTransport(
  new SmtpTransport({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'user', pass: 'password' },
  }),
  {
    tracerProvider,
    meterProvider,
    tracing: { enabled: true },
    metrics: { enabled: true },
  },
);

const message = createMessage({
  from: 'notifications@example.com',
  to: 'customer@example.com',
  subject: 'Order Confirmation',
  content: { text: 'Your order has been confirmed.' },
});

await transport.send(message);
// Both OpenTelemetry components and SMTP transport are automatically disposed
```

This approach ensures that connection pools, observability exporters,
and other resources are properly cleaned up even if errors occur during
email sending operations.

## Distributed tracing

One of OpenTelemetry's most powerful features is distributed tracing,
which tracks requests across multiple services and components.  The email
transport automatically participates in distributed traces by creating
child spans that inherit the current trace context:

```js
const { trace } = require('@opentelemetry/api');
const { createMessage } = require('@alexify/mailer');
const { MailgunTransport } = require('@alexify/mailer/mailgun');
const { createOpenTelemetryTransport } = require('@alexify/mailer/otel');

const transport = createOpenTelemetryTransport(
  new MailgunTransport({
    apiKey: 'your-api-key',
    domain: 'mg.example.com',
  }),
  {
    tracerProvider,
    meterProvider,
    tracing: {
      enabled: true,
      recordSensitiveData: false,
    },
  },
);

// Example of a distributed trace across multiple operations
const tracer = trace.getTracer('user-registration');

await tracer.startActiveSpan('user-registration', async (span) => {
  try {
    // Simulate user creation logic
    span.setAttributes({
      'user.id': '12345',
      'user.email': 'newuser@example.com',
    });

    // Send welcome email - this automatically becomes a child span
    const message = createMessage({
      from: 'welcome@example.com',
      to: 'newuser@example.com',
      subject: 'Welcome to our platform',
      content: { text: 'Thank you for joining us!' },
    });

    await transport.send(message);

    span.setStatus({ code: 1 }); // OK
  } catch (error) {
    if (error instanceof Error) {
      span.recordException(error);
    }
    span.setStatus({ code: 2, message: String(error) }); // ERROR
    throw error;
  } finally {
    span.end();
  }
});
```

The email sending operation appears as a child span in your distributed trace,
showing its relationship to the broader user registration flow.
This makes it easy to understand how email delivery affects overall request
performance and to identify bottlenecks in your system.

## Metrics and monitoring

The OpenTelemetry transport automatically collects comprehensive metrics
about email operations, including delivery rates, latency, message sizes,
and error categorization.  These metrics are essential for monitoring
email system health and performance:

```js
const { createOpenTelemetryTransport } = require('@alexify/mailer/otel');
const { SendGridTransport } = require('@alexify/mailer/sendgrid');

const transport = createOpenTelemetryTransport(
  new SendGridTransport({
    apiKey: 'your-sendgrid-api-key',
  }),
  {
    tracerProvider,
    meterProvider,
    metrics: {
      enabled: true,
      prefix: 'marketing',
      durationBuckets: [0.1, 0.5, 1.0, 2.0, 5.0, 10.0],
    },
    tracing: {
      enabled: true,
      samplingRate: 0.1, // Sample 10% of traces
    },
  },
);
```

Metrics are recorded for every operation; `tracing.samplingRate` samples
only the spans. A sampled counter would undercount by the sampling rate, and a
sampled count of active sends would drift, so the metrics configuration has no
sampling rate, and setting `metrics.samplingRate` throws a `TypeError`.
`random`, a function like `Math.random`, decides which operations get a span,
for a deterministic sampling in tests. `durationBuckets` reaches the SDK as the advice `explicitBucketBoundaries` of the
duration histogram (OpenTelemetry API 1.7 or later); a View of the application
takes precedence over it.

The instruments follow the naming of the OpenTelemetry semantic conventions:
dotted names under `metrics.prefix` (`mailer` by default), with the unit in the
`unit` of the instrument rather than in its name, which an exporter such as
Prometheus turns into its own (`mailer_email_attempts_total`):

| Instrument | Kind | Unit | Attributes |
|---|---|---|---|
| `mailer.email.attempts` | counter | `{attempt}` | `mailer.transport.name`, `mailer.operation.name` (`send`, `send_batch`), `mailer.status` (`success`, `failure`, `partial_failure`), `error.type` on a failure |
| `mailer.email.duration` | histogram | `s` | as `mailer.email.attempts` |
| `mailer.email.messages` | counter | `{message}` | `mailer.transport.name`, `email.priority`, `mailer.status` |
| `mailer.email.retries` | counter | `{retry}` | `mailer.transport.name`, `error.type` |
| `mailer.email.message.size` | histogram | `By` | `mailer.transport.name`, `email.priority`, `email.content.type` |
| `mailer.email.attachments` | histogram | `{attachment}` | as `mailer.email.message.size` |
| `mailer.email.active_sends` | up-down counter | `{send}` | `mailer.transport.name` |

A message is counted once in `mailer.email.messages`, when its receipt comes back;
a send operation, of one message or a whole batch, once in `mailer.email.attempts`.
`error.type` is the category of the failure, from `errorClassifier`. The retries
are those of the wrapped transport, reported through `onRetry`; a span shows
them as `retry` events and in `mailer.retry.count`.

An HTTP transport gives its spans `network.protocol.name` `http` with `url.scheme`
(`https`), `server.address` and `server.port`; an SMTP one `smtp`. The `exception`
event of a thrown error carries `exception.stacktrace`, with the message redacted
like the rest of the error text.

These metrics are exported to your configured observability backend
(Prometheus, DataDog, etc.) where you can create dashboards and alerts
to monitor your email system's health.

## Sensitive data

With `tracing.recordSensitiveData` off, the default, a span records the sender's
domain rather than its address, and the error text it records, in its status
and in its `exception` and `email.send_failed` events, has every address
replaced by `[REDACTED]`. An SMTP rejection such as
`RCPT TO failed for bob@example.com: 550 No such user` is recorded as
`RCPT TO failed for [REDACTED]: 550 No such user`. Turn the option on only for
a backend where personal data is allowed.

## Error classification and analysis

The OpenTelemetry transport includes intelligent error classification that
automatically categorizes email failures into meaningful groups.  This helps
you quickly identify and respond to different types of issues:

```js
const { createOpenTelemetryTransport, createErrorClassifier } = require('@alexify/mailer/otel');
const { MailgunTransport } = require('@alexify/mailer/mailgun');

// Custom error classifier for your specific needs
const customClassifier = createErrorClassifier({
  patterns: {
    spam_filter: /blocked.*spam|spam.*detected|reputation/i,
    bounce: /bounce|undeliverable|invalid.*recipient/i,
    quota_exceeded: /quota.*exceeded|mailbox.*full/i,
    temporary_failure: /temporary.*failure|try.*again.*later/i,
  },
  fallback: 'email_error',
});

const transport = createOpenTelemetryTransport(
  new MailgunTransport({
    apiKey: 'your-api-key',
    domain: 'mg.example.com',
  }),
  {
    tracerProvider,
    meterProvider,
    errorClassifier: customClassifier,
    metrics: { enabled: true },
    tracing: { enabled: true },
  },
);
```

Error classifications appear in both metrics and trace data, allowing you to:

 -  Monitor error rates by category in dashboards
 -  Set up targeted alerts for specific error types
 -  Analyze error patterns across different email types
 -  Identify systematic issues vs. temporary problems

The default classifier gives the category that `classifyReceiptError` of the
root entry gives a failed receipt (`auth`, `rate-limit`, `network`, `timeout`,
`validation`, `server-error` and so on), so a thrown error and a failed receipt
land in the same categories, and `aborted` for an `AbortError`, which is a
cancellation rather than a failure of the transport.

## Custom attributes and context

You can enhance telemetry data with custom attributes that provide additional
context about your email operations.  This is particularly useful for
tracking business metrics alongside technical metrics:

```js
const {
  createOpenTelemetryTransport,
  createEmailAttributeExtractor,
} = require('@alexify/mailer/otel');
const { SmtpTransport } = require('@alexify/mailer/smtp');

const customExtractor = createEmailAttributeExtractor('smtp', {
  recordSensitiveData: false,
  transportVersion: '1.0.0',
  customAttributes: (operation, transportName, messageCount, totalSize) => ({
    'app.version': '2.1.0',
    'app.environment': process.env.NODE_ENV || 'development',
    'deployment.id': process.env.DEPLOYMENT_ID || 'unknown',
    'email.campaign.type': 'transactional', // Custom business context
    'email.priority': 'high',
  }),
});

const transport = createOpenTelemetryTransport(
  new SmtpTransport({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'smtp-user', pass: 'smtp-password' },
  }),
  {
    tracerProvider,
    meterProvider,
    attributeExtractor: customExtractor,
    tracing: { enabled: true },
    metrics: { enabled: true },
  },
);
```

Custom attributes appear in both traces and metrics, enabling you to:

 -  Filter and group telemetry data by business context
 -  Correlate email performance with deployment versions
 -  Track different email campaigns or types separately
 -  Add environment-specific context for debugging

## Raw messages and verification

`sendRaw()` goes through the wrapped transport in a span of its own,
`email send_raw`, whose attributes are those of the envelope (`email.to.count`,
the sender's domain or, with `recordSensitiveData`, its address) and the size of
the content, and in the metrics of a send.  `verify()` verifies the wrapped
transport.  A wrapped transport without `sendRaw()` gives a failure of the
category `configuration`.

## Bulk email monitoring

For applications that send large volumes of emails, the OpenTelemetry transport
provides specialized monitoring for batch operations with detailed performance
tracking and error analysis:

```js
const { createOpenTelemetryTransport } = require('@alexify/mailer/otel');
const { MailgunTransport } = require('@alexify/mailer/mailgun');
const { createMessage } = require('@alexify/mailer');

const transport = createOpenTelemetryTransport(
  new MailgunTransport({
    apiKey: 'your-api-key',
    domain: 'mg.example.com',
    retries: 3,
  }),
  {
    tracerProvider,
    meterProvider,
    metrics: { enabled: true },
    tracing: {
      enabled: true,
      samplingRate: 0.01, // Sample 1% of individual messages
    },
  },
);

// Generate newsletter messages for subscribers
const subscribers = await getNewsletterSubscribers();
const messages = subscribers.map((subscriber) =>
  createMessage({
    from: 'newsletter@example.com',
    to: subscriber.email,
    subject: 'Weekly Update - December 2024',
    content: {
      html: generateNewsletterHtml(subscriber),
      text: generateNewsletterText(subscriber),
    },
    tags: ['newsletter', 'weekly', subscriber.segment],
  }),
);

// Send with comprehensive monitoring
let successCount = 0;
let failureCount = 0;

for await (const receipt of transport.sendMany(messages)) {
  if (receipt.successful) {
    successCount++;
  } else {
    failureCount++;
    console.error(`Failed to send to ${receipt.errorMessages.join(', ')}`);
  }
}

console.log(`Newsletter sent: ${successCount} successful, ${failureCount} failed`);
```

Batch operations generate additional metrics including:

- Batch size tracking: Monitor the distribution of batch sizes

- Success/failure ratios: Track delivery rates across batches

- Processing duration: Measure how long large batches take

- Partial failure analysis: Understand patterns in batch failures

This information helps you optimize batch processing, identify optimal
batch sizes, and detect issues that affect bulk email delivery.

## Performance optimization

The OpenTelemetry transport includes several features to minimize performance
impact while providing comprehensive observability.  You can tune sampling
rates and feature toggles based on your monitoring needs:

```js
const { createOpenTelemetryTransport } = require('@alexify/mailer/otel');
const { SmtpTransport } = require('@alexify/mailer/smtp');

// Production configuration with optimized performance
const transport = createOpenTelemetryTransport(
  new SmtpTransport({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'user', pass: 'password' },
    pool: true,
    poolSize: 10,
  }),
  {
    tracerProvider,
    meterProvider,
    metrics: {
      enabled: true,
      prefix: 'prod',
    },
    tracing: {
      enabled: true,
      samplingRate: 0.05, // Sample 5% of traces
      recordSensitiveData: false, // Optimize for privacy and performance
    },
  },
);

// High-throughput configuration for bulk operations
const bulkTransport = createOpenTelemetryTransport(
  new SmtpTransport({
    host: 'bulk-smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'bulk-user', pass: 'bulk-password' },
    pool: true,
    poolSize: 20,
  }),
  {
    tracerProvider,
    meterProvider,
    metrics: { enabled: true },
    tracing: { enabled: false }, // Disable tracing for maximum performance
  },
);
```

Performance considerations for different scenarios:

- High-frequency transactional emails: Enable metrics, sample traces at 1–5%

- Bulk campaigns: Focus on metrics, disable or heavily sample tracing

- Development environments: Enable full observability for debugging

- Testing: Disable observability or use mock backends

## Development and testing

For development and testing environments, you can configure the OpenTelemetry
transport to provide comprehensive observability without affecting external
monitoring systems:

```js
const { createOpenTelemetryTransport } = require('@alexify/mailer/otel');
const { MockTransport } = require('@alexify/mailer/mock');

// Development configuration with full observability
const devTransport = createOpenTelemetryTransport(
  new MockTransport({
    failureRate: 0,
    delay: 100,
  }),
  {
    tracerProvider,
    meterProvider,
    metrics: { enabled: true },
    tracing: {
      enabled: true,
      samplingRate: 1.0,
      recordSensitiveData: true, // OK for development
    },
  },
);

// Testing configuration with observability validation
const testTransport = createOpenTelemetryTransport(new MockTransport({ failureRate: 0 }), {
  tracerProvider,
  meterProvider,
  metrics: { enabled: true },
  tracing: { enabled: true },
  errorClassifier: (error) => {
    if (error instanceof Error) {
      // Custom test error classification
      if (error.message.includes('test-auth-failure')) return 'auth';
      if (error.message.includes('test-rate-limit')) return 'rate-limit';
    }
    return 'test_error';
  },
});
```

> [!TIP]
> When testing OpenTelemetry integration, consider using in-memory exporters
> or console exporters to validate that telemetry data is being generated
> correctly without requiring external observability infrastructure.
> The OpenTelemetry SDK provides excellent testing utilities for validating
> trace and metric data in your test suites.

The observability data from development and testing helps you:

 -  Validate that instrumentation is working correctly
 -  Test error handling and classification logic
 -  Verify that custom attributes are being applied properly
 -  Optimize observability configuration before production deployment
