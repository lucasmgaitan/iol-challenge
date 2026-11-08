export const Algorithm = {
  TokenBucket: 'token-bucket',
  SlidingWindow: 'sliding-window',
} as const;

export type Algorithm = (typeof Algorithm)[keyof typeof Algorithm];

export interface TokenBucketRule {
  readonly algorithm: typeof Algorithm.TokenBucket;
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export interface SlidingWindowRule {
  readonly algorithm: typeof Algorithm.SlidingWindow;
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
