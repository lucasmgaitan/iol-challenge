export const Algorithm = {
  TokenBucket: 'token-bucket',
  SlidingWindow: 'sliding-window',
} as const;

export type Algorithm = (typeof Algorithm)[keyof typeof Algorithm];

export interface RuleBase {
  readonly name: string;
}

export interface TokenBucketRule extends RuleBase {
  readonly algorithm: typeof Algorithm.TokenBucket;
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export interface SlidingWindowRule extends RuleBase {
  readonly algorithm: typeof Algorithm.SlidingWindow;
  readonly limit: number;
  readonly windowMs: number;
}

export interface RuleByAlgorithm {
  [Algorithm.TokenBucket]: TokenBucketRule;
  [Algorithm.SlidingWindow]: SlidingWindowRule;
}

export type Rule = RuleByAlgorithm[Algorithm];

export interface Decision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterMs: number;
}

export interface RateLimitStrategy<R extends Rule> {
  validate(rule: R): void;
  retentionMs(rule: R): number;
}

export interface RateLimiter {
  consume(key: string, rule: Rule): Promise<Decision>;
}

export interface RateLimitStore {
  consume(key: string, rule: Rule, ttlMs: number): Promise<Decision>;
}
