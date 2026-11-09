import { requirePositiveInteger } from '#core/rule.js';
import type { Evaluation, RateLimitStrategy, SlidingWindowRule } from '#core/types.js';

export interface SlidingWindowState {
  readonly windowStart: number;
  readonly current: number;
  readonly previous: number;
}

export const slidingWindow: RateLimitStrategy<SlidingWindowRule, SlidingWindowState> = {
  validate(rule) {
    requirePositiveInteger(rule, 'limit');
    requirePositiveInteger(rule, 'windowMs');
  },
  evaluate,
};

function evaluate(
  prev: SlidingWindowState | undefined,
  rule: SlidingWindowRule,
  now: number,
): Evaluation<SlidingWindowState> {
  const { limit, windowMs } = rule;
  const windowStart = Math.floor(now / windowMs) * windowMs;

  let current = 0;
  let previous = 0;
  if (prev && prev.windowStart === windowStart) {
    ({ current, previous } = prev);
  } else if (prev && prev.windowStart === windowStart - windowMs) {
    previous = prev.current;
  } else if (prev && prev.windowStart > windowStart) {
    return evaluate(prev, rule, prev.windowStart);
  }

  const elapsed = now - windowStart;
  const overlap = 1 - elapsed / windowMs;
  const estimated = current + previous * overlap;

  if (estimated + 1 <= limit) {
    return {
      state: { windowStart, current: current + 1, previous },
      decision: {
        allowed: true,
        limit,
        remaining: Math.max(0, Math.floor(limit - estimated - 1)),
        retryAfterMs: 0,
      },
    };
  }

  return {
    state: { windowStart, current, previous },
    decision: {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterMs: retryAfter(current, previous, elapsed, rule),
    },
  };
}

function retryAfter(
  current: number,
  previous: number,
  elapsed: number,
  { limit, windowMs }: SlidingWindowRule,
): number {
  if (current + 1 <= limit) {
    // previous * (1 - t/W) <= limit - 1 - current  →  t >= W * (1 - (limit - 1 - current) / previous)
    const t = windowMs * (1 - (limit - 1 - current) / previous);
    return Math.max(1, Math.ceil(t - elapsed));
  }
  // current * (1 - t/W) <= limit - 1  →  t >= W * (1 - (limit - 1) / current)
  const t = windowMs * (1 - (limit - 1) / current);
  return Math.ceil(windowMs - elapsed + t);
}
