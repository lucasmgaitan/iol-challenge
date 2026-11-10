import { slidingWindow } from '#strategies/sliding-window.js';
import { tokenBucket } from '#strategies/token-bucket.js';
import {
  Algorithm,
  type RateLimitStrategy,
  type RuleByAlgorithm,
  type StateByAlgorithm,
} from '#core/types.js';

type StrategyRegistry = {
  readonly [A in Algorithm]: RateLimitStrategy<RuleByAlgorithm[A], StateByAlgorithm[A]>;
};

export const strategies: StrategyRegistry = {
  [Algorithm.TokenBucket]: tokenBucket,
  [Algorithm.SlidingWindow]: slidingWindow,
};
