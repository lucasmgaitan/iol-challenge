import { describe, expect, it, vi } from 'vitest';
import { RateLimiterUnavailableError } from '#core/errors.js';
import { createRateLimiter } from '#core/rate-limiter.js';
import {
  Algorithm,
  FailurePolicy,
  type Decision,
  type ExecutionPolicy,
  type RateLimiterObserver,
  type RateLimitStore,
  type Rule,
} from '#core/types.js';

const rule: Rule = {
  name: 'test',
  algorithm: Algorithm.TokenBucket,
  capacity: 2,
  refillPerSecond: 1,
};
const decision: Decision = {
  allowed: true,
  limit: 2,
  remaining: 1,
  retryAfterMs: 0,
  degraded: false,
};
const storeFailure = new Error('connection refused');

function workingStore() {
  const consume = vi.fn<RateLimitStore['consume']>().mockResolvedValue(decision);
  return { store: { consume }, consume };
}

function failingStore() {
  const consume = vi.fn<RateLimitStore['consume']>().mockRejectedValue(storeFailure);
  return { store: { consume }, consume };
}

function spyObserver() {
  const onDecision = vi.fn<RateLimiterObserver['onDecision']>();
  const onStoreError = vi.fn<RateLimiterObserver['onStoreError']>();
  return { observer: { onDecision, onStoreError }, onDecision, onStoreError };
}

describe('RateLimiter execution policy', () => {
  it('calls the store through the injected execution policy', async () => {
    const { store, consume } = workingStore();
    let executions = 0;
    const executionPolicy: ExecutionPolicy = {
      execute: async (fn) => {
        executions++;
        return await fn();
      },
    };
    await createRateLimiter({ store, executionPolicy }).consume('k', rule);
    expect(executions).toBe(1);
    expect(consume).toHaveBeenCalledOnce();
  });
});

describe('RateLimiter failure policy', () => {
  it('fails open by default: allows the request and marks the decision as degraded', async () => {
    const { store } = failingStore();
    const result = await createRateLimiter({ store }).consume('k', rule);
    expect(result).toMatchObject({ allowed: true, degraded: true });
  });

  it('fails closed when configured, keeping the store error as cause', async () => {
    const { store } = failingStore();
    const limiter = createRateLimiter({ store, failurePolicy: FailurePolicy.Closed });
    await expect(limiter.consume('k', rule)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    await expect(limiter.consume('k', rule)).rejects.toHaveProperty('cause', storeFailure);
  });

  it('does not treat an invalid rule as a store failure', async () => {
    const { store } = workingStore();
    const { observer, onStoreError } = spyObserver();
    const limiter = createRateLimiter({ store, observer });
    await expect(limiter.consume('k', { ...rule, capacity: 0 })).rejects.toThrow(RangeError);
    expect(onStoreError).not.toHaveBeenCalled();
  });
});

describe('RateLimiter observer', () => {
  it('reports every decision', async () => {
    const { store } = workingStore();
    const { observer, onDecision } = spyObserver();
    await createRateLimiter({ store, observer }).consume('k', rule);
    expect(onDecision).toHaveBeenCalledWith(rule, decision);
  });

  it('reports store errors and the resulting fail-open decision', async () => {
    const { store } = failingStore();
    const { observer, onDecision, onStoreError } = spyObserver();
    await createRateLimiter({ store, observer }).consume('k', rule);
    expect(onStoreError).toHaveBeenCalledWith(rule, storeFailure);
    expect(onDecision).toHaveBeenCalledWith(rule, expect.objectContaining({ degraded: true }));
  });
});
