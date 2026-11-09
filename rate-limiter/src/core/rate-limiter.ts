import { strategies, type StateByAlgorithm } from '#strategies/registry.js';
import { systemClock, type Clock } from '#core/clock.js';
import { requireValidName } from '#core/rule.js';
import type {
  Algorithm,
  Decision,
  RateLimiter,
  Rule,
  RuleByAlgorithm,
  StateStore,
  StateTransition,
} from '#core/types.js';

const STATE_KEY_SEPARATOR = ':';

export interface RateLimiterDependencies {
  readonly store: StateStore;
  readonly clock?: Clock;
}

export function createRateLimiter({
  store,
  clock = systemClock,
}: RateLimiterDependencies): RateLimiter {
  async function consumeWith<A extends Algorithm>(
    algorithm: A,
    rule: RuleByAlgorithm[A],
    key: string,
  ): Promise<Decision> {
    const strategy = strategies[algorithm];
    requireValidName(rule);
    strategy.validate(rule);
    const now = clock.now();

    return await store.update(
      [rule.name, algorithm, key].join(STATE_KEY_SEPARATOR),
      (prev: StateByAlgorithm[A] | undefined): StateTransition<StateByAlgorithm[A], Decision> => {
        const { state, decision } = strategy.evaluate(prev, rule, now);
        return { state, result: decision };
      },
    );
  }

  return {
    consume: async (key: string, rule: Rule) => await consumeWith(rule.algorithm, rule, key),
  };
}
