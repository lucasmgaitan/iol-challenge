import { Algorithm, type Rule } from './types.js';

export const RuleErrorMessage = {
  positiveInteger: (field: string, value: number) =>
    `${field} must be a positive integer, got ${String(value)}`,
  positiveNumber: (field: string, value: number) =>
    `${field} must be a positive number, got ${String(value)}`,
} as const;

type NumericField<R> = { [K in keyof R]-?: R[K] extends number ? K : never }[keyof R] & string;

function requirePositiveInteger<R extends Rule>(rule: R, field: NumericField<R>): void {
  const value = rule[field] as number;
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(RuleErrorMessage.positiveInteger(field, value));
  }
}

function requirePositiveNumber<R extends Rule>(rule: R, field: NumericField<R>): void {
  const value = rule[field] as number;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(RuleErrorMessage.positiveNumber(field, value));
  }
}

export function assertValidRule(rule: Rule): void {
  switch (rule.algorithm) {
    case Algorithm.TokenBucket:
      requirePositiveInteger(rule, 'capacity');
      requirePositiveNumber(rule, 'refillPerSecond');
      return;
    case Algorithm.SlidingWindow:
      requirePositiveInteger(rule, 'limit');
      requirePositiveInteger(rule, 'windowMs');
      return;
  }
}
