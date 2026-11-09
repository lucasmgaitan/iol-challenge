import { setTimeout } from 'node:timers/promises';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '#core/rate-limiter.js';
import { Algorithm, type Decision, type RateLimiter, type Rule } from '#core/types.js';
import { DEFAULT_KEY_PREFIX, RedisStore } from '#stores/redis-store.js';

const REDIS_IMAGE = 'redis:7.4-alpine';
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;
const INSTANCE_COUNT = 3;

const bucket: Rule = {
  name: 'test',
  algorithm: Algorithm.TokenBucket,
  capacity: 3,
  refillPerSecond: 1,
};
const window: Rule = {
  name: 'test',
  algorithm: Algorithm.SlidingWindow,
  limit: 4,
  windowMs: 3_600_000,
};

describe('RedisStore', () => {
  let container: StartedRedisContainer;
  let connections: Redis[];
  let limiters: RateLimiter[];

  beforeAll(async () => {
    container = await new RedisContainer(REDIS_IMAGE).start();
    connections = Array.from(
      { length: INSTANCE_COUNT },
      () => new Redis(container.getConnectionUrl()),
    );
    limiters = connections.map((redis) => createRateLimiter({ store: new RedisStore({ redis }) }));
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await Promise.all(connections.map((redis) => redis.quit()));
    await container.stop();
  });

  beforeEach(async () => {
    await connections[0]?.flushall();
  });

  const limiter = (): RateLimiter => limiters[0] as RateLimiter;
  const redis = (): Redis => connections[0] as Redis;

  async function burst(rule: Rule, requests: number): Promise<Decision[]> {
    const decisions: Decision[] = [];
    for (let request = 0; request < requests; request++) {
      decisions.push(await limiter().consume('k', rule));
    }
    return decisions;
  }

  it('token bucket: allows a burst up to capacity, then rejects', async () => {
    const decisions = await burst(bucket, 4);
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
    expect(decisions.every((d) => d.limit === 3)).toBe(true);
  });

  it('sliding window: allows up to the limit within the window, then rejects', async () => {
    const decisions = await burst(window, 5);
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([3, 2, 1, 0, 0]);
    expect(decisions[4]?.retryAfterMs).toBeGreaterThan(0);
  });

  it('keeps independent counters per key and per rule', async () => {
    await burst(bucket, 3);
    expect((await limiter().consume('k', bucket)).allowed).toBe(false);
    expect((await limiter().consume('other', bucket)).allowed).toBe(true);
    expect((await limiter().consume('k', { ...bucket, name: 'other' })).allowed).toBe(true);
  });

  it('tells how long to wait when the bucket is empty', async () => {
    await burst(bucket, 3);
    const denied = await limiter().consume('k', bucket);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('refills tokens using the Redis clock', async () => {
    const fast: Rule = { ...bucket, capacity: 1, refillPerSecond: 10 };
    await limiter().consume('k', fast);
    expect((await limiter().consume('k', fast)).allowed).toBe(false);
    await setTimeout(150);
    expect((await limiter().consume('k', fast)).allowed).toBe(true);
  });

  it('stores state under the key prefix with the TTL requested by the strategy', async () => {
    await limiter().consume('203.0.113.7', bucket);
    const ttl = await redis().pttl(`${DEFAULT_KEY_PREFIX}test:token-bucket:203.0.113.7`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3000);
  });

  it('allows exactly `capacity` out of concurrent requests from several instances', async () => {
    const rule: Rule = { ...bucket, capacity: 50, refillPerSecond: 0.001 };
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, request) =>
        (limiters[request % INSTANCE_COUNT] as RateLimiter).consume('k', rule),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(50);
  });

  it('reloads the script when Redis no longer has it cached', async () => {
    await limiter().consume('k', bucket);
    await redis().script('FLUSH');
    expect((await limiter().consume('k', bucket)).remaining).toBe(1);
  });
});
