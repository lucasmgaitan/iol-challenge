export const RateLimiterErrorMessage = {
  unavailable: 'rate limiter store is unavailable',
} as const;

export class RateLimiterUnavailableError extends Error {
  override readonly name = RateLimiterUnavailableError.name;

  constructor(cause: Error) {
    super(RateLimiterErrorMessage.unavailable, { cause });
  }
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
