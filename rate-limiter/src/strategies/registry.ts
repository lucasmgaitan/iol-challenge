import { slidingWindow, type SlidingWindowState } from '#strategies/sliding-window.js';
import { tokenBucket, type TokenBucketState } from '#strategies/token-bucket.js';
import { Algorithm, type RateLimitStrategy, type RuleByAlgorithm } from '#core/types.js';

export interface StateByAlgorithm {
  [Algorithm.TokenBucket]: TokenBucketState;
  [Algorithm.SlidingWindow]: SlidingWindowState;
}

export type StrategyRegistry = {
  readonly [A in Algorithm]: RateLimitStrategy<RuleByAlgorithm[A], StateByAlgorithm[A]>;
};

export const strategies: StrategyRegistry = {
  [Algorithm.TokenBucket]: tokenBucket,
  [Algorithm.SlidingWindow]: slidingWindow,
};
