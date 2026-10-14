// Ported from upyo v0.7.0 (packages/pool/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * @alexify/mailer/pool - Pool transport for Upyo email library
 *
 * Provides load balancing and failover capabilities for combining
 * multiple email transports with various strategies.
 *
 * @packageDocumentation
 */

const { PoolTransport } = require('./pool-transport.js');

const { RoundRobinStrategy } = require('./strategies/round-robin-strategy.js');
const { WeightedStrategy } = require('./strategies/weighted-strategy.js');
const { PriorityStrategy } = require('./strategies/priority-strategy.js');
const { SelectorStrategy } = require('./strategies/selector-strategy.js');

module.exports = {
  PoolTransport,
  RoundRobinStrategy,
  WeightedStrategy,
  PriorityStrategy,
  SelectorStrategy,
};
