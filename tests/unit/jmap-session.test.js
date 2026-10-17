// Ported from upyo v0.7.0 (packages/jmap/src/session.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findMailAccount } = require('../../src/jmap/session.js');

describe('findMailAccount', () => {
  it('should find account with mail capability', () => {
    const session = {
      capabilities: {},
      accounts: {
        'account-1': {
          name: 'Test Account',
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities: {
            'urn:ietf:params:jmap:mail': {},
          },
        },
      },
      primaryAccounts: {},
      username: 'test@example.com',
      apiUrl: 'https://jmap.example.com/api',
      downloadUrl: 'https://jmap.example.com/download/{blobId}',
      uploadUrl: 'https://jmap.example.com/upload/{accountId}',
      state: '123',
    };

    const accountId = findMailAccount(session);
    assert.equal(accountId, 'account-1');
  });

  it('should return null when no mail account exists', () => {
    const session = {
      capabilities: {},
      accounts: {
        'account-1': {
          name: 'Contacts Account',
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities: {
            'urn:ietf:params:jmap:contacts': {},
          },
        },
      },
      primaryAccounts: {},
      username: 'test@example.com',
      apiUrl: 'https://jmap.example.com/api',
      downloadUrl: 'https://jmap.example.com/download/{blobId}',
      uploadUrl: 'https://jmap.example.com/upload/{accountId}',
      state: '123',
    };

    const accountId = findMailAccount(session);
    assert.equal(accountId, null);
  });

  it('should find first mail account when multiple exist', () => {
    const session = {
      capabilities: {},
      accounts: {
        'contacts-only': {
          name: 'Contacts Only',
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities: {
            'urn:ietf:params:jmap:contacts': {},
          },
        },
        'mail-account': {
          name: 'Mail Account',
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities: {
            'urn:ietf:params:jmap:mail': {},
          },
        },
      },
      primaryAccounts: {},
      username: 'test@example.com',
      apiUrl: 'https://jmap.example.com/api',
      downloadUrl: 'https://jmap.example.com/download/{blobId}',
      uploadUrl: 'https://jmap.example.com/upload/{accountId}',
      state: '123',
    };

    const accountId = findMailAccount(session);
    assert.equal(accountId, 'mail-account');
  });
});
