export const RuleErrorMessage = {
  positiveInteger: (field: string, value: number) =>
    `${field} must be a positive integer, got ${String(value)}`,
  positiveNumber: (field: string, value: number) =>
    `${field} must be a positive number, got ${String(value)}`,
} as const;

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
