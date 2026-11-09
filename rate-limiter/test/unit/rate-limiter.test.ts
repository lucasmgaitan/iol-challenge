import { describe, expect, it } from 'vitest';
import { FakeClock } from '#core/clock.js';
import { createRateLimiter } from '#core/rate-limiter.js';
import { Algorithm, type RateLimiter, type Rule } from '#core/types.js';
import { MemoryStore } from '#stores/memory-store.js';

const bucket: Rule = { algorithm: Algorithm.TokenBucket, capacity: 2, refillPerSecond: 1 };
const window: Rule = { algorithm: Algorithm.SlidingWindow, limit: 2, windowMs: 1000 };

function limiterWith(clock = new FakeClock()): RateLimiter {
  return createRateLimiter({ store: new MemoryStore(), clock });
}

describe('RateLimiter', () => {
  it('keeps independent counters per key', async () => {
    const limiter = limiterWith();
    await limiter.consume('a', bucket);
    await limiter.consume('a', bucket);
    expect((await limiter.consume('a', bucket)).allowed).toBe(false);
    expect((await limiter.consume('b', bucket)).allowed).toBe(true);
  });

  it('does not mix state between strategies for the same key', async () => {
    const limiter = limiterWith();
    await limiter.consume('a', bucket);
    await limiter.consume('a', bucket);
    expect((await limiter.consume('a', window)).allowed).toBe(true);
  });

  it('uses the injected clock', async () => {
    const clock = new FakeClock();
    const limiter = limiterWith(clock);
    await limiter.consume('a', bucket);
    await limiter.consume('a', bucket);
    expect((await limiter.consume('a', bucket)).allowed).toBe(false);
    clock.advance(1000);
    expect((await limiter.consume('a', bucket)).allowed).toBe(true);
  });

  it('allows exactly `limit` out of many concurrent calls', async () => {
    const limiter = limiterWith();
    const rule: Rule = { algorithm: Algorithm.TokenBucket, capacity: 50, refillPerSecond: 1 };
    const results = await Promise.all(
      Array.from({ length: 200 }, () => limiter.consume('k', rule)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(50);
  });

  it.each<[string, Rule]>([
    ['zero capacity', { algorithm: Algorithm.TokenBucket, capacity: 0, refillPerSecond: 1 }],
    [
      'fractional capacity',
      { algorithm: Algorithm.TokenBucket, capacity: 1.5, refillPerSecond: 1 },
    ],
    ['zero refill', { algorithm: Algorithm.TokenBucket, capacity: 1, refillPerSecond: 0 }],
    ['NaN refill', { algorithm: Algorithm.TokenBucket, capacity: 1, refillPerSecond: Number.NaN }],
    ['zero limit', { algorithm: Algorithm.SlidingWindow, limit: 0, windowMs: 1000 }],
    ['negative window', { algorithm: Algorithm.SlidingWindow, limit: 1, windowMs: -1 }],
  ])('rejects invalid rules: %s', async (_, rule) => {
    await expect(limiterWith().consume('k', rule)).rejects.toThrow(RangeError);
  });
});
