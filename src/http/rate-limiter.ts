import {
  createRateLimiter,
  FailurePolicy,
  type RateLimiter,
  type RateLimitRepository,
} from '@iol/rate-limiter';
import { circuitBreaker, ConsecutiveBreaker, handleAll } from 'cockatiel';

export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_HALF_OPEN_AFTER_MS = 10_000;

export function createAppRateLimiter(repository: RateLimitRepository): RateLimiter {
  const breaker = circuitBreaker(handleAll, {
    halfOpenAfter: CIRCUIT_HALF_OPEN_AFTER_MS,
    breaker: new ConsecutiveBreaker(CIRCUIT_FAILURE_THRESHOLD),
  });

  return createRateLimiter({
    repository,
    executionPolicy: breaker,
    failurePolicy: FailurePolicy.Open,
  });
}
