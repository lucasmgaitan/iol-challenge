import { requirePositiveInteger, requirePositiveNumber } from '#core/rule.js';
import type { Evaluation, RateLimitStrategy, TokenBucketRule } from '#core/types.js';

export interface TokenBucketState {
  readonly tokens: number;
  readonly updatedAt: number;
}

export const tokenBucket: RateLimitStrategy<TokenBucketRule, TokenBucketState> = {
  validate(rule) {
    requirePositiveInteger(rule, 'capacity');
    requirePositiveNumber(rule, 'refillPerSecond');
  },
  evaluate,
};

function evaluate(
  prev: TokenBucketState | undefined,
  rule: TokenBucketRule,
  now: number,
): Evaluation<TokenBucketState> {
  const { capacity, refillPerSecond } = rule;

  const elapsedMs = prev ? Math.max(0, now - prev.updatedAt) : 0;
  const available = prev
    ? Math.min(capacity, prev.tokens + (elapsedMs * refillPerSecond) / 1000)
    : capacity;
  const updatedAt = prev ? Math.max(now, prev.updatedAt) : now;

  if (available >= 1) {
    const tokens = available - 1;
    return {
      state: { tokens, updatedAt },
      decision: { allowed: true, limit: capacity, remaining: Math.floor(tokens), retryAfterMs: 0 },
    };
  }

  const missing = 1 - available;
  return {
    state: { tokens: available, updatedAt },
    decision: {
      allowed: false,
      limit: capacity,
      remaining: 0,
      retryAfterMs: Math.ceil((missing / refillPerSecond) * 1000),
    },
  };
}
