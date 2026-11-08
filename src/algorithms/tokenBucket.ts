import type { Decision, TokenBucketRule } from '../core/types.js';

export interface TokenBucketState {
  /** Tokens disponibles; puede ser fraccionario por el refill continuo. */
  readonly tokens: number;
  /** Último instante (ms) en que se calculó el refill. */
  readonly updatedAt: number;
}

/**
 * Función pura: dado el estado previo (o ninguno), la regla y el instante actual,
 * devuelve el nuevo estado y la decisión. No guarda nada: eso es tarea del store.
 * El script Lua de Redis (fase 3) replica exactamente esta lógica.
 */
export function tokenBucket(
  prev: TokenBucketState | undefined,
  rule: TokenBucketRule,
  now: number,
): { state: TokenBucketState; decision: Decision } {
  const { capacity, refillPerSecond } = rule;

  // Si el reloj va para atrás no "devolvemos" tokens: tomamos elapsed = 0.
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
