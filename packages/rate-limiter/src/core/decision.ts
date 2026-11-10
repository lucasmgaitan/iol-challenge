import type { Decision } from '#core/types.js';

export function allow(limit: number, remaining: number): Decision {
  return { allowed: true, limit, remaining, retryAfterMs: 0, degraded: false };
}

export function deny(limit: number, retryAfterMs: number): Decision {
  return { allowed: false, limit, remaining: 0, retryAfterMs, degraded: false };
}
