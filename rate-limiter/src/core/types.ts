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

export interface Evaluation<S> {
  readonly state: S;
  readonly decision: Decision;
}

export interface RateLimitStrategy<R extends Rule, S> {
  validate(rule: R): void;
  evaluate(prev: S | undefined, rule: R, now: number): Evaluation<S>;
}

export interface RateLimiter {
  consume(key: string, rule: Rule): Promise<Decision>;
}

export interface StateTransition<S, R> {
  readonly state: S;
  readonly result: R;
}

export interface StateStore {
  update<S, R>(
    key: string,
    transition: (prev: S | undefined) => StateTransition<S, R>,
  ): R | Promise<R>;
}
