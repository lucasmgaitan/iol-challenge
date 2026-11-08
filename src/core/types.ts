/**
 * Regla de token bucket: el bucket arranca lleno con `capacity` tokens y se
 * rellena de forma continua a `refillPerSecond`. Cada request consume 1 token.
 * Permite ráfagas de hasta `capacity` y un promedio de `refillPerSecond` req/s.
 */
export interface TokenBucketRule {
  readonly algorithm: 'token-bucket';
  readonly capacity: number;
  readonly refillPerSecond: number;
}

/**
 * Regla de sliding window counter: como mucho `limit` requests en cualquier
 * ventana de `windowMs`, estimado ponderando la ventana fija anterior.
 */
export interface SlidingWindowRule {
  readonly algorithm: 'sliding-window';
  readonly limit: number;
  readonly windowMs: number;
}

export type Rule = TokenBucketRule | SlidingWindowRule;

/** Resultado de intentar consumir una request. Mapea 1:1 a los headers X-Ratelimit-*. */
export interface Decision {
  readonly allowed: boolean;
  readonly limit: number;
  /** Requests que quedan disponibles ahora mismo (después de esta, si fue permitida). */
  readonly remaining: number;
  /** Cuánto esperar antes de reintentar. 0 si fue permitida. */
  readonly retryAfterMs: number;
}

/** Punto de entrada único: esconde algoritmo, storage y reloj. */
export interface RateLimiter {
  consume(key: string, rule: Rule): Promise<Decision>;
}
