import { describe, expect, it } from 'vitest';
import { Algorithm, type TokenBucketRule, type TokenBucketState } from '#core/types.js';
import { tokenBucket } from '#strategies/token-bucket.js';

const rule: TokenBucketRule = {
  name: 'test',
  algorithm: Algorithm.TokenBucket,
  capacity: 3,
  refillPerSecond: 2,
};
const NOW_MS = 1_000_000;

function burst(requests: number, nowMs = NOW_MS) {
  let stored: TokenBucketState | undefined;
  const decisions = [];
  for (let request = 0; request < requests; request++) {
    const { decision, state } = tokenBucket.decide(rule, stored, nowMs);
    decisions.push(decision);
    stored = state ?? stored;
  }
  return { decisions, stored };
}

describe('token bucket', () => {
  it('starts full, allows a burst up to capacity, then rejects', () => {
    const { decisions } = burst(4);
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
    expect(decisions.every((d) => d.limit === rule.capacity)).toBe(true);
  });

  it('tells how long until the next token', () => {
    const empty: TokenBucketState = { tokens: 0.5, updatedAt: NOW_MS };
    expect(tokenBucket.decide(rule, empty, NOW_MS).decision.retryAfterMs).toBe(250);
  });

  it('does not persist anything when it rejects', () => {
    const empty: TokenBucketState = { tokens: 0, updatedAt: NOW_MS };
    expect(tokenBucket.decide(rule, empty, NOW_MS).state).toBeUndefined();
  });

  it('refills over time without exceeding capacity', () => {
    const empty: TokenBucketState = { tokens: 0, updatedAt: NOW_MS };
    expect(tokenBucket.decide(rule, empty, NOW_MS + 500).state).toEqual({
      tokens: 0,
      updatedAt: NOW_MS + 500,
    });
    expect(tokenBucket.decide(rule, empty, NOW_MS + 60_000).state).toEqual({
      tokens: 2,
      updatedAt: NOW_MS + 60_000,
    });
  });

  it('ignores a clock that goes backwards', () => {
    const stored: TokenBucketState = { tokens: 1, updatedAt: NOW_MS };
    expect(tokenBucket.decide(rule, stored, NOW_MS - 10_000).state).toEqual({
      tokens: 0,
      updatedAt: NOW_MS,
    });
  });
});
