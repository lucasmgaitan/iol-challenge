import type { Decision, SlidingWindowRule } from '../core/types.js';

export interface SlidingWindowState {
  /** Inicio (ms) de la ventana fija actual. */
  readonly windowStart: number;
  /** Requests permitidas en la ventana fija actual. */
  readonly current: number;
  /** Requests permitidas en la ventana fija anterior. */
  readonly previous: number;
}

/**
 * Sliding window counter (libro, cap. 4): estima las requests de la última
 * `windowMs` como `current + previous * (fracción de la ventana anterior que
 * todavía se solapa)`. Usa O(1) memoria por clave, a cambio de suponer que las
 * requests de la ventana anterior estaban distribuidas de forma pareja.
 */
export function slidingWindow(
  prev: SlidingWindowState | undefined,
  rule: SlidingWindowRule,
  now: number,
): { state: SlidingWindowState; decision: Decision } {
  const { limit, windowMs } = rule;
  const windowStart = Math.floor(now / windowMs) * windowMs;

  let current = 0;
  let previous = 0;
  if (prev && prev.windowStart === windowStart) {
    ({ current, previous } = prev);
  } else if (prev && prev.windowStart === windowStart - windowMs) {
    previous = prev.current;
  } else if (prev && prev.windowStart > windowStart) {
    // Reloj hacia atrás: conservamos el estado más reciente en lugar de resetear.
    return slidingWindow(prev, rule, prev.windowStart);
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

/**
 * Cuánto falta para que `estimado + 1 <= limit`, suponiendo que no entran más requests.
 * - Si con lo de la ventana actual alcanza (`current + 1 <= limit`), basta con que
 *   la ventana anterior se "desplace" lo suficiente dentro de esta misma ventana.
 * - Si no, hay que esperar a la próxima ventana, donde `current` pasa a ser `previous`.
 */
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
  // En la próxima ventana: current * (1 - t/W) <= limit - 1  →  t >= W * (1 - (limit - 1) / current)
  const t = windowMs * (1 - (limit - 1) / current);
  return Math.ceil(windowMs - elapsed + t);
}
