import { strategies } from '#strategies/registry.js';
import { deny } from '#core/decision.js';
import { RateLimitContentionError, RateLimiterUnavailableError, toError } from '#core/errors.js';
import { requireValidName } from '#core/rule.js';
import {
  FailurePolicy,
  type Algorithm,
  type Decision,
  type ExecutionPolicy,
  type RateLimiter,
  type RateLimitRepository,
  type Rule,
  type RuleByAlgorithm,
  type StateByAlgorithm,
  type StateTransition,
} from '#core/types.js';

const STATE_KEY_SEPARATOR = ':';
const RETRY_IMMEDIATELY_MS = 0;

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

interface RateLimiterDependencies {
  readonly repository: RateLimitRepository;
  readonly executionPolicy?: ExecutionPolicy;
  readonly failurePolicy?: FailurePolicy;
}

export function createRateLimiter({
  repository,
  executionPolicy = directExecution,
  failurePolicy = FailurePolicy.Open,
}: RateLimiterDependencies): RateLimiter {
  async function consumeWith<A extends Algorithm>(
    algorithm: A,
    rule: RuleByAlgorithm[A],
    key: string,
  ): Promise<Decision> {
    const strategy = strategies[algorithm];
    requireValidName(rule);
    strategy.validate(rule);

    const transition: StateTransition = (stored, nowMs) =>
      strategy.decide(rule, stored as StateByAlgorithm[A] | undefined, nowMs);

    return await decide(
      [rule.name, algorithm, key].join(STATE_KEY_SEPARATOR),
      strategy.retentionMs(rule),
      transition,
      strategy.limit(rule),
    );
  }

  async function decide(
    storeKey: string,
    ttlMs: number,
    transition: StateTransition,
    limit: number,
  ): Promise<Decision> {
    try {
      return await executionPolicy.execute(() => updateOrDeny(storeKey, ttlMs, transition, limit));
    } catch (error) {
      if (failurePolicy === FailurePolicy.Closed) {
        throw new RateLimiterUnavailableError(toError(error));
      }
      return FAILED_OPEN;
    }
  }

  async function updateOrDeny(
    storeKey: string,
    ttlMs: number,
    transition: StateTransition,
    limit: number,
  ): Promise<Decision> {
    try {
      return await repository.update(storeKey, ttlMs, transition);
    } catch (error) {
      if (error instanceof RateLimitContentionError) return deny(limit, RETRY_IMMEDIATELY_MS);
      throw error;
    }
  }

  return {
    consume: async (key: string, rule: Rule) => await consumeWith(rule.algorithm, rule, key),
  };
}
