import { describe, expect, it } from 'vitest';
import { FakeClock } from '#core/clock.js';
import { Algorithm, type Rule } from '#core/types.js';
import { MemoryStore } from '#stores/memory-store.js';

const bucket: Rule = { algorithm: Algorithm.TokenBucket, capacity: 2, refillPerSecond: 1 };
const window: Rule = { algorithm: Algorithm.SlidingWindow, limit: 2, windowMs: 1000 };

describe('MemoryStore', () => {
  it('keeps independent counters per key', () => {
    const store = new MemoryStore(new FakeClock());
    store.consume('a', bucket);
    store.consume('a', bucket);
    expect(store.consume('a', bucket).allowed).toBe(false);
    expect(store.consume('b', bucket).allowed).toBe(true);
  });

  it('does not mix state between algorithms for the same key', () => {
    const store = new MemoryStore(new FakeClock());
    store.consume('a', bucket);
    store.consume('a', bucket);
    expect(store.consume('a', window).allowed).toBe(true);
  });

  it('uses the injected clock', () => {
    const clock = new FakeClock();
    const store = new MemoryStore(clock);
    store.consume('a', bucket);
    store.consume('a', bucket);
    expect(store.consume('a', bucket).allowed).toBe(false);
    clock.advance(1000);
    expect(store.consume('a', bucket).allowed).toBe(true);
  });

  it('allows exactly `limit` out of many calls at the same instant', () => {
    const store = new MemoryStore(new FakeClock());
    const rule: Rule = { algorithm: Algorithm.TokenBucket, capacity: 50, refillPerSecond: 1 };
    const results = Array.from({ length: 200 }, () => store.consume('k', rule));
    expect(results.filter((r) => r.allowed)).toHaveLength(50);
  });

  it.each<[string, Rule]>([
    ['zero capacity', { algorithm: Algorithm.TokenBucket, capacity: 0, refillPerSecond: 1 }],
    [
      'fractional capacity',
      { algorithm: Algorithm.TokenBucket, capacity: 1.5, refillPerSecond: 1 },
    ],
    ['zero refill', { algorithm: Algorithm.TokenBucket, capacity: 1, refillPerSecond: 0 }],
    ['NaN refill', { algorithm: Algorithm.TokenBucket, capacity: 1, refillPerSecond: Number.NaN }],
    ['zero limit', { algorithm: Algorithm.SlidingWindow, limit: 0, windowMs: 1000 }],
    ['negative window', { algorithm: Algorithm.SlidingWindow, limit: 1, windowMs: -1 }],
  ])('rejects invalid rules: %s', (_, rule) => {
    expect(() => new MemoryStore().consume('k', rule)).toThrow(RangeError);
  });
});
