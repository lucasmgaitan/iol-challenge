import { describe, expect, it } from 'vitest';
import { tokenBucket, type TokenBucketState } from '#strategies/token-bucket.js';
import { Algorithm, type Decision, type TokenBucketRule } from '#core/types.js';

const rule: TokenBucketRule = {
  name: 'test',
  algorithm: Algorithm.TokenBucket,
  capacity: 3,
  refillPerSecond: 1,
};

function run(times: number[], r: TokenBucketRule = rule): Decision[] {
  let state: TokenBucketState | undefined;
  return times.map((t) => {
    const out = tokenBucket.evaluate(state, r, t);
    state = out.state;
    return out.decision;
  });
}

describe('tokenBucket', () => {
  it('starts full and allows a burst up to capacity', () => {
    const d = run([0, 0, 0, 0]);
    expect(d.map((x) => x.allowed)).toEqual([true, true, true, false]);
    expect(d.map((x) => x.remaining)).toEqual([2, 1, 0, 0]);
    expect(d.every((x) => x.limit === 3)).toBe(true);
  });

  it('tells how long to wait for the next token', () => {
    const d = run([0, 0, 0, 0]);
    expect(d[3]?.retryAfterMs).toBe(1000);
    expect(d[0]?.retryAfterMs).toBe(0);
  });

  it('refills continuously (partial refill)', () => {
    const d = run([0, 0, 0, 500, 1000]);
    expect(d[3]).toMatchObject({ allowed: false, retryAfterMs: 500 });
    expect(d[4]?.allowed).toBe(true);
  });

  it('never refills above capacity', () => {
    const d = run([0, 60_000, 60_000, 60_000, 60_000]);
    expect(d.map((x) => x.allowed)).toEqual([true, true, true, true, false]);
  });

  it('does not grant tokens when the clock goes backwards', () => {
    const d = run([10_000, 10_000, 10_000, 5_000]);
    expect(d[3]?.allowed).toBe(false);
  });

  it('supports fractional refill rates', () => {
    const slow: TokenBucketRule = {
      name: 'test',
      algorithm: Algorithm.TokenBucket,
      capacity: 1,
      refillPerSecond: 0.5,
    };
    const d = run([0, 0, 1999, 2000], slow);
    expect(d.map((x) => x.allowed)).toEqual([true, false, false, true]);
    expect(d[1]?.retryAfterMs).toBe(2000);
  });
});
