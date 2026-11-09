import type { Decision, RateLimiterObserver, Rule } from '@iol/rate-limiter';
import { collectDefaultMetrics, Counter, Gauge, Registry } from 'prom-client';

export const MetricName = {
  Decisions: 'rate_limit_decisions_total',
  StoreErrors: 'rate_limit_store_errors_total',
  CircuitOpen: 'rate_limit_circuit_open',
} as const;

const MetricHelp = {
  Decisions: 'Rate limit decisions by rule and outcome',
  StoreErrors: 'Rate limit store failures by rule',
  CircuitOpen:
    'Whether the circuit breaker in front of the rate limit store is open (1) or not (0)',
} as const;

const Label = {
  Rule: 'rule',
  Outcome: 'outcome',
} as const;

export const Outcome = {
  Allowed: 'allowed',
  Rejected: 'rejected',
  FailedOpen: 'failed_open',
} as const;

const CIRCUIT_OPEN = 1;
const CIRCUIT_NOT_OPEN = 0;

export interface AppMetrics {
  readonly registry: Registry;
  readonly observer: RateLimiterObserver;
  setCircuitOpen(open: boolean): void;
}

export function createMetrics(): AppMetrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const decisions = new Counter({
    name: MetricName.Decisions,
    help: MetricHelp.Decisions,
    labelNames: [Label.Rule, Label.Outcome],
    registers: [registry],
  });
  const storeErrors = new Counter({
    name: MetricName.StoreErrors,
    help: MetricHelp.StoreErrors,
    labelNames: [Label.Rule],
    registers: [registry],
  });
  const circuitOpen = new Gauge({
    name: MetricName.CircuitOpen,
    help: MetricHelp.CircuitOpen,
    registers: [registry],
  });
  circuitOpen.set(CIRCUIT_NOT_OPEN);

  return {
    registry,
    observer: {
      onDecision: (rule: Rule, decision: Decision) => {
        decisions.inc({ [Label.Rule]: rule.name, [Label.Outcome]: outcomeOf(decision) });
      },
      onStoreError: (rule: Rule) => {
        storeErrors.inc({ [Label.Rule]: rule.name });
      },
    },
    setCircuitOpen: (open: boolean) => {
      circuitOpen.set(open ? CIRCUIT_OPEN : CIRCUIT_NOT_OPEN);
    },
  };
}

function outcomeOf({ allowed, degraded }: Decision): string {
  if (degraded) return Outcome.FailedOpen;
  return allowed ? Outcome.Allowed : Outcome.Rejected;
}
