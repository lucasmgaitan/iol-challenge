import { allow, deny } from '#core/decision.js';
import { requirePositiveInteger } from '#core/rule.js';
import type { RateLimitStrategy, SlidingWindowRule, SlidingWindowState } from '#core/types.js';

interface CurrentWindow {
  readonly state: SlidingWindowState;
  readonly elapsedMs: number;
}

function currentWindow(
  stored: SlidingWindowState | undefined,
  nowMs: number,
  windowMs: number,
): CurrentWindow {
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  if (stored && stored.windowStart > windowStart) return { state: stored, elapsedMs: 0 };
  if (stored?.windowStart === windowStart) {
    return { state: stored, elapsedMs: nowMs - windowStart };
  }
  const previous = stored?.windowStart === windowStart - windowMs ? stored.current : 0;
  return { state: { windowStart, current: 0, previous }, elapsedMs: nowMs - windowStart };
}

export const slidingWindow: RateLimitStrategy<SlidingWindowRule, SlidingWindowState> = {
  validate(rule) {
    requirePositiveInteger(rule, 'limit');
    requirePositiveInteger(rule, 'windowMs');
  },
  retentionMs: ({ windowMs }) => 2 * windowMs,
  limit: ({ limit }) => limit,
  decide({ limit, windowMs }, stored, nowMs) {
    const { state, elapsedMs } = currentWindow(stored, nowMs, windowMs);
    const { current, previous } = state;
    const estimated = current + previous * (1 - elapsedMs / windowMs);

    if (estimated + 1 <= limit) {
      return {
        decision: allow(limit, Math.max(0, Math.floor(limit - estimated - 1))),
        state: { ...state, current: current + 1 },
      };
    }

    if (current + 1 <= limit) {
      // previous * (1 - t/W) <= limit - 1 - current  →  t >= W * (1 - (limit - 1 - current) / previous)
      const t = windowMs * (1 - (limit - 1 - current) / previous);
      return { decision: deny(limit, Math.max(1, Math.ceil(t - elapsedMs))) };
    }

    // current * (1 - t/W) <= limit - 1  →  t >= W * (1 - (limit - 1) / current)
    const t = windowMs * (1 - (limit - 1) / current);
    return { decision: deny(limit, Math.ceil(windowMs - elapsedMs + t)) };
  },
};
