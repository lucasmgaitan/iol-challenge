import { describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '#core/rate-limiter.js';
import { RuleErrorMessage } from '#core/rule.js';
import { Algorithm, type Decision, type RateLimitStore, type Rule } from '#core/types.js';

const bucket: Rule = {
  name: 'test',
  algorithm: Algorithm.TokenBucket,
  capacity: 2,
  refillPerSecond: 1,
};
const window: Rule = { name: 'test', algorithm: Algorithm.SlidingWindow, limit: 2, windowMs: 1000 };
const decision: Decision = {
  allowed: true,
  limit: 2,
  remaining: 1,
  retryAfterMs: 0,
  degraded: false,
};

function fakeStore() {
  const consume = vi.fn<RateLimitStore['consume']>().mockResolvedValue(decision);
  return { store: { consume }, consume };
}

describe('RateLimiter', () => {
  it('returns the decision made by the store', async () => {
    const { store } = fakeStore();
    expect(await createRateLimiter({ store }).consume('k', bucket)).toEqual(decision);
  });

  it('stores state under rule name, algorithm and key', async () => {
    const { store, consume } = fakeStore();
    await createRateLimiter({ store }).consume('203.0.113.7', { ...bucket, name: 'login' });
    expect(consume.mock.calls[0]?.[0]).toBe('login:token-bucket:203.0.113.7');
  });

  it.each<[string, Rule, number]>([
    [
      'token bucket: time to refill completely',
      { ...bucket, capacity: 10, refillPerSecond: 4 },
      2500,
    ],
    ['sliding window: two windows', { ...window, windowMs: 60_000 }, 120_000],
  ])('asks the store to retain state only as long as it matters (%s)', async (_, rule, ttlMs) => {
    const { store, consume } = fakeStore();
    await createRateLimiter({ store }).consume('k', rule);
    expect(consume.mock.calls[0]?.[2]).toBe(ttlMs);
  });

  it.each<[string, Rule]>([
    ['zero capacity', { ...bucket, capacity: 0 }],
    ['fractional capacity', { ...bucket, capacity: 1.5 }],
    ['zero refill', { ...bucket, refillPerSecond: 0 }],
    ['NaN refill', { ...bucket, refillPerSecond: Number.NaN }],
    ['zero limit', { ...window, limit: 0 }],
    ['negative window', { ...window, windowMs: -1 }],
    ['empty name', { ...bucket, name: '' }],
    ['name with separator', { ...bucket, name: 'login:admin' }],
    ['name not kebab-case', { ...bucket, name: 'Login_Rule' }],
  ])('rejects invalid rules without reaching the store: %s', async (_, rule) => {
    const { store, consume } = fakeStore();
    await expect(createRateLimiter({ store }).consume('k', rule)).rejects.toThrow(RangeError);
    expect(consume).not.toHaveBeenCalled();
  });

  it('reports the offending rule name', async () => {
    const { store } = fakeStore();
    await expect(
      createRateLimiter({ store }).consume('k', { ...bucket, name: 'Bad' }),
    ).rejects.toThrow(RuleErrorMessage.invalidName('Bad'));
  });
});
