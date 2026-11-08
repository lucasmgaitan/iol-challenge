export interface TokenBucketRule {
  readonly algorithm: 'token-bucket';
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export interface SlidingWindowRule {
  readonly algorithm: 'sliding-window';
  readonly limit: number;
  readonly windowMs: number;
}

export type Rule = TokenBucketRule | SlidingWindowRule;

export interface Decision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string, rule: Rule): Promise<Decision>;
}
