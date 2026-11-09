import { strategies } from '#strategies/registry.js';
import { requireValidName } from '#core/rule.js';
import type {
  Algorithm,
  Decision,
  RateLimiter,
  RateLimitStore,
  Rule,
  RuleByAlgorithm,
} from '#core/types.js';

const STATE_KEY_SEPARATOR = ':';

export interface RateLimiterDependencies {
  readonly store: RateLimitStore;
}

export function createRateLimiter({ store }: RateLimiterDependencies): RateLimiter {
  async function consumeWith<A extends Algorithm>(
    algorithm: A,
    rule: RuleByAlgorithm[A],
    key: string,
  ): Promise<Decision> {
    const strategy = strategies[algorithm];
    requireValidName(rule);
    strategy.validate(rule);

    return await store.consume(
      [rule.name, algorithm, key].join(STATE_KEY_SEPARATOR),
      rule,
      strategy.retentionMs(rule),
    );
  }

  return {
    consume: async (key: string, rule: Rule) => await consumeWith(rule.algorithm, rule, key),
  };
}
