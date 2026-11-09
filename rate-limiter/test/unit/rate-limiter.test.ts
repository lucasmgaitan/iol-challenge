import { describe, expect, it } from 'vitest';
import { FakeClock } from '#core/clock.js';
import { createRateLimiter } from '#core/rate-limiter.js';
import { RuleErrorMessage } from '#core/rule.js';
import { Algorithm, type RateLimiter, type Rule, type StateStore } from '#core/types.js';
import { MemoryStore } from '#stores/memory-store.js';

const bucket: Rule = {
  name: 'test',
  algorithm: Algorithm.TokenBucket,
  capacity: 2,
  refillPerSecond: 1,
};
const window: Rule = { name: 'test', algorithm: Algorithm.SlidingWindow, limit: 2, windowMs: 1000 };

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

  it('does not share state between rules with the same algorithm and key', async () => {
    const limiter = limiterWith();
    const login: Rule = { ...bucket, name: 'login' };
    const search: Rule = { ...bucket, name: 'search' };
    await limiter.consume('a', login);
    await limiter.consume('a', login);
    expect((await limiter.consume('a', login)).allowed).toBe(false);
    expect((await limiter.consume('a', search)).allowed).toBe(true);
  });

  it('stores state under rule name, algorithm and key', async () => {
    const keys: string[] = [];
    const memory = new MemoryStore();
    const store: StateStore = {
      update: (key, transition) => {
        keys.push(key);
        return memory.update(key, transition);
      },
    };
    await createRateLimiter({ store, clock: new FakeClock() }).consume('203.0.113.7', {
      ...bucket,
      name: 'login',
    });
    expect(keys).toEqual(['login:token-bucket:203.0.113.7']);
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
    const rule: Rule = {
      name: 'test',
      algorithm: Algorithm.TokenBucket,
      capacity: 50,
      refillPerSecond: 1,
    };
    const results = await Promise.all(
      Array.from({ length: 200 }, () => limiter.consume('k', rule)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(50);
  });

  it.each<[string, Rule]>([
    [
      'zero capacity',
      { name: 'test', algorithm: Algorithm.TokenBucket, capacity: 0, refillPerSecond: 1 },
    ],
    [
      'fractional capacity',
      { name: 'test', algorithm: Algorithm.TokenBucket, capacity: 1.5, refillPerSecond: 1 },
    ],
    [
      'zero refill',
      { name: 'test', algorithm: Algorithm.TokenBucket, capacity: 1, refillPerSecond: 0 },
    ],
    [
      'NaN refill',
      { name: 'test', algorithm: Algorithm.TokenBucket, capacity: 1, refillPerSecond: Number.NaN },
    ],
    ['zero limit', { name: 'test', algorithm: Algorithm.SlidingWindow, limit: 0, windowMs: 1000 }],
    [
      'negative window',
      { name: 'test', algorithm: Algorithm.SlidingWindow, limit: 1, windowMs: -1 },
    ],
    ['empty name', { ...bucket, name: '' }],
    ['name with separator', { ...bucket, name: 'login:admin' }],
    ['name not kebab-case', { ...bucket, name: 'Login_Rule' }],
  ])('rejects invalid rules: %s', async (_, rule) => {
    await expect(limiterWith().consume('k', rule)).rejects.toThrow(RangeError);
  });

  it('reports the offending rule name', async () => {
    await expect(limiterWith().consume('k', { ...bucket, name: 'Bad' })).rejects.toThrow(
      RuleErrorMessage.invalidName('Bad'),
    );
  });
});
