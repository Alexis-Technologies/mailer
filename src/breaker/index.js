// Ported from unemail v0.7.0 (src/middleware/circuit-breaker.ts): the entry of
// the circuit breaker.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { CircuitBreakerTransport } = require('./breaker-transport.js');

module.exports = { CircuitBreakerTransport };
