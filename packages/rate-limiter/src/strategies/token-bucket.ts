import { requirePositiveInteger, requirePositiveNumber } from '#core/rule.js';
import type { RateLimitStrategy, TokenBucketRule } from '#core/types.js';

export const tokenBucket: RateLimitStrategy<TokenBucketRule> = {
  validate(rule) {
    requirePositiveInteger(rule, 'capacity');
    requirePositiveNumber(rule, 'refillPerSecond');
  },
  retentionMs: ({ capacity, refillPerSecond }) => Math.ceil((capacity / refillPerSecond) * 1000),
};
