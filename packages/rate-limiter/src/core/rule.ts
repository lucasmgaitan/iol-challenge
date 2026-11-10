import type { RuleBase } from '#core/types.js';

const RULE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RuleErrorMessage = {
  positiveInteger: (field: string, value: number) =>
    `${field} must be a positive integer, got ${String(value)}`,
  positiveNumber: (field: string, value: number) =>
    `${field} must be a positive number, got ${String(value)}`,
  invalidName: (name: string) => `rule name must be kebab-case, got "${name}"`,
} as const;

export function requireValidName(rule: RuleBase): void {
  if (!RULE_NAME_PATTERN.test(rule.name)) {
    throw new RangeError(RuleErrorMessage.invalidName(rule.name));
  }
}

type NumericField<R> = { [K in keyof R]-?: R[K] extends number ? K : never }[keyof R] & string;

export function requirePositiveInteger<R>(rule: R, field: NumericField<R>): void {
  const value = rule[field] as number;
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(RuleErrorMessage.positiveInteger(field, value));
  }
}

export function requirePositiveNumber<R>(rule: R, field: NumericField<R>): void {
  const value = rule[field] as number;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(RuleErrorMessage.positiveNumber(field, value));
  }
}
