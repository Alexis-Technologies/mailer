// Not ported: the key under which ./webhooks keeps an id in its replay store,
// the provider and a SHA-256 of the id, for tests that watch a store.

const { createHash } = require('node:crypto');

const storeKey = (key) => {
  const colon = key.indexOf(':');
  const digest = createHash('sha256')
    .update(key.slice(colon + 1))
    .digest('base64url');
  return `${key.slice(0, colon + 1)}${digest}`;
};

module.exports = { storeKey };
