const RateLimiterErrorMessage = {
  unavailable: 'rate limiter store is unavailable',
  contention: (key: string) => `gave up updating "${key}" after repeated concurrent writes`,
} as const;

export class RateLimiterUnavailableError extends Error {
  override readonly name = RateLimiterUnavailableError.name;

  constructor(cause: Error) {
    super(RateLimiterErrorMessage.unavailable, { cause });
  }
}

export class RateLimitContentionError extends Error {
  override readonly name = RateLimitContentionError.name;

  constructor(key: string) {
    super(RateLimiterErrorMessage.contention(key));
  }
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
