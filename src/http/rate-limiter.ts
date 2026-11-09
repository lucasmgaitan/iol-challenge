import {
  createRateLimiter,
  FailurePolicy,
  type RateLimiter,
  type RateLimitStore,
} from '@iol/rate-limiter';
import { circuitBreaker, CircuitState, ConsecutiveBreaker, handleAll } from 'cockatiel';
import type { FastifyBaseLogger } from 'fastify';
import type { AppMetrics } from '#http/metrics.js';

export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_HALF_OPEN_AFTER_MS = 10_000;

export const LogMessage = {
  storeError: 'rate limit store failed, letting the request through',
  circuitOpened: 'rate limit store circuit opened: skipping the store until it recovers',
  circuitClosed: 'rate limit store circuit closed: store recovered',
} as const;

export interface AppRateLimiterDependencies {
  readonly store: RateLimitStore;
  readonly logger: FastifyBaseLogger;
  readonly metrics: AppMetrics;
}

export function createAppRateLimiter({
  store,
  logger,
  metrics,
}: AppRateLimiterDependencies): RateLimiter {
  const breaker = circuitBreaker(handleAll, {
    halfOpenAfter: CIRCUIT_HALF_OPEN_AFTER_MS,
    breaker: new ConsecutiveBreaker(CIRCUIT_FAILURE_THRESHOLD),
  });
  breaker.onBreak(() => {
    logger.error(LogMessage.circuitOpened);
  });
  breaker.onReset(() => {
    logger.info(LogMessage.circuitClosed);
  });
  breaker.onStateChange((state) => {
    metrics.setCircuitOpen(state === CircuitState.Open);
  });

  return createRateLimiter({
    store,
    executionPolicy: breaker,
    failurePolicy: FailurePolicy.Open,
    observer: {
      onDecision: (rule, decision) => {
        metrics.observer.onDecision(rule, decision);
      },
      onStoreError: (rule, error) => {
        logger.warn({ rule: rule.name, err: error }, LogMessage.storeError);
        metrics.observer.onStoreError(rule, error);
      },
    },
  });
}
