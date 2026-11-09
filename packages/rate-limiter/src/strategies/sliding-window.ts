import { requirePositiveInteger } from '#core/rule.js';
import type { RateLimitStrategy, SlidingWindowRule } from '#core/types.js';

export const slidingWindow: RateLimitStrategy<SlidingWindowRule> = {
  validate(rule) {
    requirePositiveInteger(rule, 'limit');
    requirePositiveInteger(rule, 'windowMs');
  },
  retentionMs: ({ windowMs }) => 2 * windowMs,
};
