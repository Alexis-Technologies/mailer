# Mock transport

The mock transport is a specialized testing utility that simulates email sending
without actually delivering messages. Instead of connecting to email servers
or APIs, it stores all “sent” messages in memory where they can be
inspected, verified, and manipulated during testing. This makes it invaluable
for unit testing, integration testing, and development workflows where you need
to verify email functionality without sending real emails.

@alexify/mailer provides a comprehensive mock transport through the *@alexify/mailer/mock* subpath,
offering configurable behavior simulation, message querying capabilities,
async testing utilities, and full compatibility with all @alexify/mailer transport
features.

## Installation

To use the mock transport, you need to install the *@alexify/mailer/mock* subpath:

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic testing

The mock transport implements the same `Transport` interface as all other @alexify/mailer
transports, making it a drop-in replacement for testing purposes. You can swap
out real transports with the mock transport in your tests without changing any
other code:

```js
const { MockTransport } = require('@alexify/mailer/mock');
const { createMessage } = require('@alexify/mailer');

// Create a basic mock transport
const transport = new MockTransport();

const message = createMessage({
  from: 'test-sender@example.com',
  to: 'test-recipient@example.com',
  subject: 'Test Email',
  content: { text: 'This is a test email for verification.' },
});

// "Send" the email (stored in memory)
const receipt = await transport.send(message);

// Verify the operation succeeded
console.log(receipt.successful); // true
if (receipt.successful) {
  console.log(receipt.messageId); // "mock-message-1"
}

// Inspect what was "sent"
const sentMessages = transport.getSentMessages();
console.log(sentMessages.length); // 1
console.log(sentMessages[0].subject); // "Test Email"
console.log(sentMessages[0].recipients[0].address); // "test-recipient@example.com"
```

The mock transport generates unique message IDs automatically and tracks all
sent messages, making it easy to verify that your email logic works correctly
without any external dependencies.

## Simulating realistic behavior

Real email services have network delays, rate limits, and occasional failures.
The mock transport can simulate these conditions to make your tests more
realistic and help you build robust error handling:

```js
const { MockTransport } = require('@alexify/mailer/mock');

// Configure realistic behavior simulation
const transport = new MockTransport({
  // Simulate network delay (100ms fixed)
  delay: 100,

  // Or use random delays for more realistic testing
  randomDelayRange: { min: 50, max: 200 },

  // Simulate random failures (10% failure rate)
  failureRate: 0.1,

  // Custom message ID generation
  generateUniqueMessageIds: true,
});

// Test your error handling
try {
  const receipt = await transport.send(message);

  if (receipt.successful) {
    console.log('Email sent successfully');
  } else {
    console.log('Email failed:', receipt.errorMessages);
  }
} catch (error) {
  console.log('Network error:', String(error));
}
```

Delay simulation helps test timeout handling and ensures your application
can handle slower network conditions: an `AbortSignal` passed to the send ends
the delay at once, and the send rejects with the reason of the signal, as a
real transport does. Failure simulation verifies that your error handling code
works correctly when email services are unavailable.

`random`, a function like `Math.random`, decides the simulated failures of
`failureRate` and the delays of `randomDelayRange`, so that a test can make them
happen exactly when it wants.

## Testing specific failure scenarios

For testing specific error conditions, you can configure the mock transport
to fail in controlled ways. This is essential for verifying that your
application handles various email service errors gracefully:

```js
const { createMessage } = require('@alexify/mailer');
const { MockTransport } = require('@alexify/mailer/mock');

const transport = new MockTransport();

// Test authentication failure
transport.setNextResponse({
  successful: false,
  errorMessages: ['Authentication failed: Invalid API key'],
});

const authFailMessage = createMessage({
  from: 'test@example.com',
  to: 'user@example.com',
  subject: 'Auth Test',
  content: { text: 'Testing auth failure' },
});

const authResult = await transport.send(authFailMessage);
console.log(authResult.successful); // false
if (!authResult.successful) {
  console.log(authResult.errorMessages); // ["Authentication failed: Invalid API key"]
}

// Test rate limiting
transport.setNextResponse({
  successful: false,
  errorMessages: ['Rate limit exceeded: Too many requests'],
});

const rateLimitResult = await transport.send(authFailMessage);
if (!rateLimitResult.successful) {
  console.log(rateLimitResult.errorMessages); // ["Rate limit exceeded: Too many requests"]
}

// Next send will use default (successful) behavior
const normalResult = await transport.send(authFailMessage);
console.log(normalResult.successful); // true
```

The `setNextResponse()` method affects only the next send operation, making it
perfect for testing specific failure scenarios while keeping the rest of your
test using normal behavior.

## Message verification and querying

A key feature of the mock transport is its ability to inspect and verify
sent messages. This goes beyond just counting messages—you can search by
recipient, subject, content, and custom criteria:

```js
const { createMessage } = require('@alexify/mailer');
const { MockTransport } = require('@alexify/mailer/mock');

const transport = new MockTransport();

// Send different types of messages
await transport.send(
  createMessage({
    from: 'support@example.com',
    to: 'user1@example.com',
    subject: 'Welcome to our service',
    content: { text: 'Welcome! Thanks for signing up.' },
    tags: ['onboarding', 'welcome'],
  }),
);

await transport.send(
  createMessage({
    from: 'billing@example.com',
    to: 'user1@example.com',
    subject: 'Invoice #1234',
    content: { text: 'Your monthly invoice is ready.' },
    tags: ['billing', 'invoice'],
  }),
);

await transport.send(
  createMessage({
    from: 'support@example.com',
    to: 'user2@example.com',
    subject: 'Welcome to our service',
    content: { text: 'Welcome! Thanks for signing up.' },
    tags: ['onboarding', 'welcome'],
  }),
);

// Query messages by recipient
const user1Messages = transport.getMessagesTo('user1@example.com');
console.log(user1Messages.length); // 2

// Query by subject
const welcomeMessages = transport.getMessagesBySubject('Welcome to our service');
console.log(welcomeMessages.length); // 2

// Custom filtering with predicates
const billingMessages = transport.findMessagesBy((msg) => msg.tags.includes('billing'));
console.log(billingMessages.length); // 1

const supportMessages = transport.findMessagesBy(
  (msg) => msg.sender.address === 'support@example.com',
);
console.log(supportMessages.length); // 2

// Find specific message
const invoice = transport.findMessageBy(
  (msg) =>
    msg.subject.includes('Invoice') &&
    msg.recipients.some((r) => r.address === 'user1@example.com'),
);
console.log(invoice?.subject); // "Invoice #1234"
```

These querying capabilities make it easy to write comprehensive tests that
verify not just that emails were sent, but that the right emails were sent
to the right recipients with the correct content.

## Async testing patterns

Many email workflows are asynchronous, such as sending emails after user
registration or periodic notifications. The mock transport provides utilities
for testing these async patterns effectively:

```js
const { createMessage } = require('@alexify/mailer');
const { MockTransport } = require('@alexify/mailer/mock');

const transport = new MockTransport();

// Simulate an async user registration flow
async function registerUser(email, name) {
  // ... registration logic ...

  // Send welcome email asynchronously
  setTimeout(async () => {
    await transport.send(
      createMessage({
        from: 'welcome@example.com',
        to: email,
        subject: `Welcome ${name}!`,
        content: { text: `Hi ${name}, welcome to our platform!` },
      }),
    );
  }, 100);

  // Send verification email asynchronously
  setTimeout(async () => {
    await transport.send(
      createMessage({
        from: 'verify@example.com',
        to: email,
        subject: 'Please verify your email',
        content: { text: 'Click here to verify your email address.' },
      }),
    );
  }, 200);
}

// Test the async workflow
await registerUser('newuser@example.com', 'John');

// Wait for both emails to be sent
await transport.waitForMessageCount(2, 5000); // 5 second timeout

// Verify the emails were sent correctly
const welcomeEmail = await transport.waitForMessage(
  (msg) =>
    msg.subject.includes('Welcome') &&
    msg.recipients.some((r) => r.address === 'newuser@example.com'),
  3000, // 3 second timeout
);

console.log(welcomeEmail.subject); // "Welcome John!"

const verificationEmail = await transport.waitForMessage(
  (msg) => msg.subject.includes('verify'),
  3000,
);

console.log(verificationEmail.subject); // "Please verify your email"
```

The `waitForMessageCount()` and `waitForMessage()` methods are essential for
testing async email workflows. They prevent race conditions in tests and
ensure reliable verification of async behavior.

## Bulk email testing

For applications that send newsletters, notifications, or other bulk emails,
the mock transport efficiently handles large message volumes while providing
detailed verification capabilities:

```js
const { MockTransport } = require('@alexify/mailer/mock');
const { createMessage } = require('@alexify/mailer');

const transport = new MockTransport();

// Simulate bulk newsletter sending
const subscribers = [
  "alice@example.com",
  "bob@example.com",
  "charlie@example.com",
  "diana@example.com",
];

const newsletterMessages = subscribers.map(email =>
  createMessage({
    from: "newsletter@example.com",
    to: email,
    subject: "Monthly Newsletter - December 2024",
    content: {
      html: "<h2>This Month's Updates</h2><p>Here's what's new...</p>",
      text: "This Month's Updates\n\nHere's what's new...",
    },
    tags: ["newsletter", "monthly", "december-2024"],
  })
);

// Send all newsletters
const receipts        = [];
for await (const receipt of transport.sendMany(newsletterMessages)) {
  receipts.push(receipt);

  if (!receipt.successful) {
    console.error(`Failed to send to recipient: ${receipt.errorMessages}`);
  }
}

// Verify bulk sending results
console.log(`Sent ${receipts.length} newsletters`);
console.log(`Successfully sent: ${receipts.filter(r => r.successful).length}`);
console.log(`Failed: ${receipts.filter(r => !r.successful).length}`);

// Verify all subscribers received the newsletter
for (const email of subscribers) {
  const userNewsletters = transport.getMessagesTo(email);
  console.log(`${email}: ${userNewsletters.length} newsletters`);
}

// Check newsletter content and tagging
const allNewsletters = transport.findMessagesBy(msg =>
  msg.tags.includes("newsletter")
);
console.log(`Total newsletters in system: ${allNewsletters.length}`);
```

The mock transport handles bulk sending efficiently and provides detailed
verification of each message, making it perfect for testing newsletter
systems, notification broadcasts, and other high-volume email features.

## Raw messages and verification

`sendRaw()` takes serialized MIME as `send()` takes a message: it applies the
delay and answers with the next response, and keeps the message apart, in
`getSentRawMessages()`.  `clearSentMessages()` clears both lists.  `verify()` has
nothing to check and resolves, unless its signal is aborted.

## Test cleanup and isolation

When running multiple tests, it's important to ensure that each test starts
with a clean state. The mock transport provides several methods for managing
test isolation:

```js
const { MockTransport } = require('@alexify/mailer/mock');
const { afterEach, beforeEach, describe, test } = require('node:test');

// Example test setup
describe('Email functionality', () => {
  let transport;

  beforeEach(() => {
    // Create fresh transport for each test
    transport = new MockTransport();
  });

  afterEach(() => {
    // Clean up between tests
    transport.reset(); // Clears messages and resets configuration
  });

  test('user registration sends welcome email', async () => {
    // ... test implementation ...

    // Verify clean starting state
    console.log(transport.getSentMessagesCount()); // 0

    // ... send emails ...

    // Verify test results
    const messages = transport.getSentMessages();
    // ... assertions ...
  });

  test('password reset sends notification', async () => {
    // This test starts with empty message history
    console.log(transport.getSentMessagesCount()); // 0

    // ... test implementation ...
  });
});

// Alternative: selective cleanup
function cleanupTransport(transport) {
  // Clear just the messages, keep configuration
  transport.clearSentMessages();

  // Or reset everything to defaults
  transport.reset();
}
```

The `reset()` method clears all messages and returns the transport to its
initial configuration, while `clearSentMessages()` removes only the message
history while preserving any custom configuration like delays or failure rates.

## Integration with testing frameworks

The mock transport integrates seamlessly with popular testing frameworks
like Jest, Mocha, Vitest and Node's built-in `node:test`. Here's how to
set it up for comprehensive email testing:

```js
const { createMessage } = require('@alexify/mailer');
const { MockTransport } = require('@alexify/mailer/mock');
const assert = require('node:assert/strict');
const { beforeEach, afterEach, test } = require('node:test');

// Test utility functions
function createTestTransport() {
  return new MockTransport();
}

function createTestMessage(overrides = {}) {
  return createMessage({
    from: 'test@example.com',
    to: 'user@example.com',
    subject: 'Test Email',
    content: { text: 'Test content' },
    ...overrides,
  });
}

// Example test suite
let transport;

beforeEach(() => {
  transport = createTestTransport();
});

afterEach(() => {
  transport.reset();
});

test('should send welcome email after user registration', async () => {
  // Arrange
  const userEmail = 'newuser@example.com';
  const welcomeMessage = createTestMessage({
    to: userEmail,
    subject: 'Welcome to our platform!',
  });

  // Act
  const receipt = await transport.send(welcomeMessage);

  // Assert
  assert.ok(receipt.successful);
  assert.equal(transport.getSentMessagesCount(), 1);

  const sentMessage = transport.getLastSentMessage();
  assert.equal(sentMessage?.recipients[0].address, userEmail);
  assert.ok(sentMessage?.subject.includes('Welcome'));
});

test('should handle email sending failures gracefully', async () => {
  // Arrange
  transport.setNextResponse({
    successful: false,
    errorMessages: ['SMTP server unavailable'],
  });

  // Act
  const receipt = await transport.send(createTestMessage());

  // Assert
  assert.equal(receipt.successful, false);
  assert.ok(receipt.errorMessages.includes('SMTP server unavailable'));

  // Message should still be tracked even when it "fails"
  assert.equal(transport.getSentMessagesCount(), 1);
});
```

This pattern provides a robust foundation for testing email functionality
across your entire application, ensuring that emails are sent correctly
and error conditions are handled appropriately.

## Development and debugging

During development, the mock transport serves as an excellent debugging tool
for understanding email flows and troubleshooting issues. You can inspect
exactly what emails your application would send without cluttering real
inboxes or hitting email service rate limits:

```js
const { MockTransport } = require('@alexify/mailer/mock');

// Development configuration with detailed logging
const transport = new MockTransport({
  delay: 0, // No delays for faster development
  failureRate: 0, // No random failures during development
  generateUniqueMessageIds: true,
});

// Add development logging
const originalSend = transport.send.bind(transport);
transport.send = async function (message, options) {
  console.log('📧 Sending email:', {
    from: message.sender.address,
    to: message.recipients.map((r) => r.address),
    subject: message.subject,
    tags: message.tags,
  });

  const result = await originalSend(message, options);

  console.log('✉️  Email result:', {
    successful: result.successful,
    messageId: result.successful ? result.messageId : 'failed',
    errors: result.successful ? [] : result.errorMessages,
  });

  return result;
};

// Use throughout your development workflow
// All email sending will be logged and stored for inspection
```

> [!TIP]
> The mock transport is perfect for development environments where you want
> to test email functionality without sending real emails. You can inspect
> the `transport.getSentMessages()` output in your browser's developer console
> or server logs to see exactly what emails your application generates.

This approach gives you complete visibility into your application's email
behavior during development, making it much easier to debug complex email
workflows and ensure they work correctly before deploying to production.
