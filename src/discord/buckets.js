// Not ported: the rate limits of Discord as its answers tell them
// (https://discord.com/developers/docs/topics/rate-limits): the requests
// left in the bucket of a route, `X-RateLimit-Remaining`, and the seconds
// until it fills again, `X-RateLimit-Reset-After`, so that a send waits for
// its bucket rather than meet a 429. Written from Discord's documentation, as
// @discordjs/rest is Apache-2.0; its queue of requests per bucket is not
// needed for sends, which the decorators bound.

const MAX_ROUTES = 1000;

/**
 * The buckets of the routes a transport sent to, the oldest dropped past a
 * thousand.
 *
 * @internal
 */
class RateLimitBuckets {
  #routes = new Map();
  #now;

  constructor(now = () => performance.now()) {
    this.#now = now;
  }

  /** Reads the bucket of a route from the header fields of its answer. */
  update(route, headers) {
    const remaining = Number(headers.get('x-ratelimit-remaining') ?? Number.NaN);
    const resetAfter = Number(headers.get('x-ratelimit-reset-after') ?? Number.NaN);
    if (!Number.isFinite(remaining) || !Number.isFinite(resetAfter)) return;
    this.#routes.delete(route);
    this.#routes.set(route, { remaining, resetAt: this.#now() + resetAfter * 1000 });
    if (this.#routes.size > MAX_ROUTES) this.#routes.delete(this.#routes.keys().next().value);
  }

  /** How long a send to a route waits for its bucket, in milliseconds. */
  delayOf(route) {
    const bucket = this.#routes.get(route);
    if (bucket === undefined || bucket.remaining > 0) return 0;
    return Math.max(0, Math.ceil(bucket.resetAt - this.#now()));
  }
}

module.exports = { RateLimitBuckets };
