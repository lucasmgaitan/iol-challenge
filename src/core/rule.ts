import type { Rule } from './types.js';

const isPositiveInt = (n: number): boolean => Number.isInteger(n) && n > 0;
const isPositive = (n: number): boolean => Number.isFinite(n) && n > 0;

/**
 * Rechaza reglas que no tienen sentido (límites en 0, negativos, NaN).
 * Un límite 0 no es "bloquear todo": para eso conviene una regla explícita de deny,
 * así no hay que inventar un Retry-After infinito.
 */
export function assertValidRule(rule: Rule): void {
  switch (rule.algorithm) {
    case 'token-bucket':
      if (!isPositiveInt(rule.capacity)) {
        throw new RangeError(`capacity must be a positive integer, got ${String(rule.capacity)}`);
      }
      if (!isPositive(rule.refillPerSecond)) {
        throw new RangeError(
          `refillPerSecond must be a positive number, got ${String(rule.refillPerSecond)}`,
        );
      }
      return;
    case 'sliding-window':
      if (!isPositiveInt(rule.limit)) {
        throw new RangeError(`limit must be a positive integer, got ${String(rule.limit)}`);
      }
      if (!isPositiveInt(rule.windowMs)) {
        throw new RangeError(`windowMs must be a positive integer, got ${String(rule.windowMs)}`);
      }
      return;
  }
}
