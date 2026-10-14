// Ported from upyo v0.7.0 (packages/jmap/src/session.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Finds the first account with mail capability from a JMAP session.
 * @param session The JMAP session response.
 * @returns The account ID with mail capability, or `null` if none found.
 */
const findMailAccount = (session) => {
  for (const [accountId, account] of Object.entries(session.accounts)) {
    if ('urn:ietf:params:jmap:mail' in account.accountCapabilities) {
      return accountId;
    }
  }
  return null;
};

module.exports = { findMailAccount };
