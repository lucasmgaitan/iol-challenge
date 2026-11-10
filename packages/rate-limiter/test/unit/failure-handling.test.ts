import { describe, expect, it, vi } from 'vitest';
import { RateLimitContentionError, RateLimiterUnavailableError } from '#core/errors.js';
import { createRateLimiter } from '#core/rate-limiter.js';
import {
  Algorithm,
  FailurePolicy,
  type Decision,
  type ExecutionPolicy,
  type RateLimitRepository,
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
const repositoryFailure = new Error('connection refused');

function workingRepository() {
  const update = vi.fn<RateLimitRepository['update']>().mockResolvedValue(decision);
  return { repository: { update }, update };
}

function failingRepository() {
  const update = vi.fn<RateLimitRepository['update']>().mockRejectedValue(repositoryFailure);
  return { repository: { update }, update };
}

describe('RateLimiter execution policy', () => {
  it('calls the repository through the injected execution policy', async () => {
    const { repository, update } = workingRepository();
    let executions = 0;
    const executionPolicy: ExecutionPolicy = {
      execute: async (fn) => {
        executions++;
        return await fn();
      },
    };
    await createRateLimiter({ repository, executionPolicy }).consume('k', rule);
    expect(executions).toBe(1);
    expect(update).toHaveBeenCalledOnce();
  });
});

describe('RateLimiter failure policy', () => {
  it('fails open by default: allows the request and marks the decision as degraded', async () => {
    const { repository } = failingRepository();
    const result = await createRateLimiter({ repository }).consume('k', rule);
    expect(result).toMatchObject({ allowed: true, degraded: true });
  });

  it('fails closed when configured, keeping the repository error as cause', async () => {
    const { repository } = failingRepository();
    const limiter = createRateLimiter({ repository, failurePolicy: FailurePolicy.Closed });
    await expect(limiter.consume('k', rule)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    await expect(limiter.consume('k', rule)).rejects.toHaveProperty('cause', repositoryFailure);
  });

  it('does not fail open on an invalid rule', async () => {
    const { repository, update } = failingRepository();
    await expect(
      createRateLimiter({ repository }).consume('k', { ...rule, capacity: 0 }),
    ).rejects.toThrow(RangeError);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('RateLimiter under contention', () => {
  it('denies the request when the repository gives up after concurrent writes', async () => {
    const update = vi
      .fn<RateLimitRepository['update']>()
      .mockRejectedValue(new RateLimitContentionError('k'));
    const limiter = createRateLimiter({
      repository: { update },
      failurePolicy: FailurePolicy.Closed,
    });
    expect(await limiter.consume('k', rule)).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterMs: 0,
      degraded: false,
    });
  });
});
