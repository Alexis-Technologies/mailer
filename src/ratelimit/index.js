// Ported from unemail v0.7.0 (src/middleware/rate-limit.ts): the entry of the
// rate limiter.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { RateLimitTransport } = require('./ratelimit-transport.js');

module.exports = { RateLimitTransport };
