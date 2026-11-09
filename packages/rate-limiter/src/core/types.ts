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
  readonly degraded: boolean;
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

export interface ExecutionPolicy {
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

export interface RateLimiterObserver {
  onDecision(rule: Rule, decision: Decision): void;
  onStoreError(rule: Rule, error: Error): void;
}

export const FailurePolicy = {
  Open: 'open',
  Closed: 'closed',
} as const;

export type FailurePolicy = (typeof FailurePolicy)[keyof typeof FailurePolicy];
