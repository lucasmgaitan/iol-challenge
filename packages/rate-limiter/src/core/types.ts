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

export type StoredState = Readonly<Record<string, number>>;

export type TokenBucketState = {
  readonly tokens: number;
  readonly updatedAt: number;
};

export type SlidingWindowState = {
  readonly windowStart: number;
  readonly current: number;
  readonly previous: number;
};

export interface StateByAlgorithm {
  [Algorithm.TokenBucket]: TokenBucketState;
  [Algorithm.SlidingWindow]: SlidingWindowState;
}

export interface Transition<S extends StoredState = StoredState> {
  readonly decision: Decision;
  readonly state?: S;
}

export type StateTransition = (stored: StoredState | undefined, nowMs: number) => Transition;

export interface RateLimitStrategy<R extends Rule, S extends StoredState> {
  validate(rule: R): void;
  retentionMs(rule: R): number;
  limit(rule: R): number;
  decide(rule: R, stored: S | undefined, nowMs: number): Transition<S>;
}

export interface RateLimiter {
  consume(key: string, rule: Rule): Promise<Decision>;
}

export interface RateLimitRepository {
  update(key: string, ttlMs: number, transition: StateTransition): Promise<Decision>;
}

export interface ExecutionPolicy {
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

export const FailurePolicy = {
  Open: 'open',
  Closed: 'closed',
} as const;

export type FailurePolicy = (typeof FailurePolicy)[keyof typeof FailurePolicy];
