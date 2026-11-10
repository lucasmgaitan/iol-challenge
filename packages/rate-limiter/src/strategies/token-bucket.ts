import { allow, deny } from '#core/decision.js';
import { requirePositiveInteger, requirePositiveNumber } from '#core/rule.js';
import type { RateLimitStrategy, TokenBucketRule, TokenBucketState } from '#core/types.js';

const MS_PER_SECOND = 1000;

export const tokenBucket: RateLimitStrategy<TokenBucketRule, TokenBucketState> = {
  validate(rule) {
    requirePositiveInteger(rule, 'capacity');
    requirePositiveNumber(rule, 'refillPerSecond');
  },
  retentionMs: ({ capacity, refillPerSecond }) =>
    Math.ceil((capacity / refillPerSecond) * MS_PER_SECOND),
  limit: ({ capacity }) => capacity,
  decide({ capacity, refillPerSecond }, stored, nowMs) {
    const refillPerMs = refillPerSecond / MS_PER_SECOND;
    const available = stored
      ? Math.min(capacity, stored.tokens + Math.max(0, nowMs - stored.updatedAt) * refillPerMs)
      : capacity;

    if (available < 1) {
      return { decision: deny(capacity, Math.ceil((1 - available) / refillPerMs)) };
    }

    const tokens = available - 1;
    const updatedAt = stored ? Math.max(nowMs, stored.updatedAt) : nowMs;
    return { decision: allow(capacity, Math.floor(tokens)), state: { tokens, updatedAt } };
  },
};
