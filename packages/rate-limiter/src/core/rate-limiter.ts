import { strategies } from '#strategies/registry.js';
import { RateLimiterUnavailableError, toError } from '#core/errors.js';
import { requireValidName } from '#core/rule.js';
import {
  FailurePolicy,
  type Algorithm,
  type Decision,
  type ExecutionPolicy,
  type RateLimiter,
  type RateLimiterObserver,
  type RateLimitStore,
  type Rule,
  type RuleByAlgorithm,
} from '#core/types.js';

const STATE_KEY_SEPARATOR = ':';

const directExecution: ExecutionPolicy = {
  execute: async (fn) => await fn(),
};

const FAILED_OPEN: Decision = {
  allowed: true,
  limit: 0,
  remaining: 0,
  retryAfterMs: 0,
  degraded: true,
};

export interface RateLimiterDependencies {
  readonly store: RateLimitStore;
  readonly executionPolicy?: ExecutionPolicy;
  readonly failurePolicy?: FailurePolicy;
  readonly observer?: RateLimiterObserver;
}

export function createRateLimiter({
  store,
  executionPolicy = directExecution,
  failurePolicy = FailurePolicy.Open,
  observer,
}: RateLimiterDependencies): RateLimiter {
  async function consumeWith<A extends Algorithm>(
    algorithm: A,
    rule: RuleByAlgorithm[A],
    key: string,
  ): Promise<Decision> {
    const strategy = strategies[algorithm];
    requireValidName(rule);
    strategy.validate(rule);

    const decision = await decide(
      rule,
      [rule.name, algorithm, key].join(STATE_KEY_SEPARATOR),
      strategy.retentionMs(rule),
    );
    observer?.onDecision(rule, decision);
    return decision;
  }

  async function decide(rule: Rule, storeKey: string, ttlMs: number): Promise<Decision> {
    try {
      return await executionPolicy.execute(() => store.consume(storeKey, rule, ttlMs));
    } catch (error) {
      const storeError = toError(error);
      observer?.onStoreError(rule, storeError);
      if (failurePolicy === FailurePolicy.Closed) throw new RateLimiterUnavailableError(storeError);
      return FAILED_OPEN;
    }
  }

  return {
    consume: async (key: string, rule: Rule) => await consumeWith(rule.algorithm, rule, key),
  };
}
