// Ported from upyo v0.7.0 (packages/smtp/src/delivery-status.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { resolveSmtpDsn, SmtpDsnValidationError } = require('../../src/smtp/delivery-status.js');
const { resolveSmtpEnvelope } = require('../../src/smtp/envelope.js');

const message = {
  sender: { address: 'sender@example.com' },
  recipients: [{ address: 'recipient@example.com' }],
  ccRecipients: [],
  bccRecipients: [],
  replyRecipients: [],
  subject: 'DSN test',
  content: { text: 'Hello' },
  attachments: [],
  priority: 'normal',
  tags: [],
  headers: new Headers(),
};

// oxlint-disable-next-line no-shadow -- upstream
const resolveMessageDsn = (message, dsn) => {
  return resolveSmtpDsn(resolveSmtpEnvelope(message), dsn);
};

describe('resolveSmtpDsn', () => {
  test('should omit DSN parameters when no setting is requested', () => {
    assert.equal(resolveMessageDsn(message, undefined), undefined);
    assert.equal(resolveMessageDsn(message, {}), undefined);
    assert.equal(
      resolveMessageDsn(message, {
        recipients: { 'recipient@example.com': {} },
      }),
      undefined,
    );
  });

  test('should accept the RFC 3461 ENVID length limit', () => {
    const dsn = resolveMessageDsn(message, { envelopeId: 'a'.repeat(94) });
    assert.equal(dsn?.mailParameters[0].length, 100);
  });

  test('should reject an empty ENVID', () => {
    assert.throws(
      () => resolveMessageDsn(message, { envelopeId: '' }),
      new SmtpDsnValidationError('DSN envelope ID must not be empty.'),
    );
  });

  test('should reject ENVID above the RFC 3461 length limit', () => {
    assert.throws(
      () => resolveMessageDsn(message, { envelopeId: 'a'.repeat(95) }),
      new SmtpDsnValidationError('ENVID parameter exceeds the RFC 3461 limit of 100 characters.'),
    );
  });

  test('should accept the RFC 3461 ORCPT length limit', () => {
    const address = `${'a'.repeat(485)}@b`;
    const dsn = resolveSmtpDsn(
      {
        from: 'sender@example.com',
        to: [address],
      },
      {
        recipients: {
          [address]: { originalRecipient: address },
        },
      },
    );
    assert.equal(dsn?.recipientParameters[0][0].length, 500);
  });

  test('should reject ORCPT above the RFC 3461 length limit', () => {
    const address = `${'a'.repeat(486)}@b`;
    assert.throws(
      () =>
        resolveSmtpDsn(
          {
            from: 'sender@example.com',
            to: [address],
          },
          {
            recipients: {
              [address]: { originalRecipient: address },
            },
          },
        ),
      new SmtpDsnValidationError('ORCPT parameter exceeds the RFC 3461 limit of 500 characters.'),
    );
  });

  test('should reject an ORCPT that differs from its envelope recipient', () => {
    assert.throws(
      () =>
        resolveMessageDsn(message, {
          recipients: {
            'recipient@example.com': {
              originalRecipient: 'forwarded@example.com',
            },
          },
        }),
      new SmtpDsnValidationError(
        'DSN original recipient for recipient@example.com must match the ' +
          'envelope recipient address.',
      ),
    );
  });

  test('should reject an empty notification condition list', () => {
    assert.throws(
      () =>
        resolveMessageDsn(message, {
          recipients: {
            'recipient@example.com': { notify: [] },
          },
        }),
      /must be a non-empty array/,
    );
  });
});
