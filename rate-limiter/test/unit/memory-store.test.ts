import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/core/clock.js';
import type { Rule } from '../../src/core/types.js';
import { MemoryStore } from '../../src/stores/memory-store.js';

const bucket: Rule = { algorithm: 'token-bucket', capacity: 2, refillPerSecond: 1 };
const window: Rule = { algorithm: 'sliding-window', limit: 2, windowMs: 1000 };

describe('MemoryStore', () => {
  it('keeps independent counters per key', async () => {
    const store = new MemoryStore(new FakeClock());
    await store.consume('a', bucket);
    await store.consume('a', bucket);
    expect((await store.consume('a', bucket)).allowed).toBe(false);
    expect((await store.consume('b', bucket)).allowed).toBe(true);
  });

  it('does not mix state between algorithms for the same key', async () => {
    const store = new MemoryStore(new FakeClock());
    await store.consume('a', bucket);
    await store.consume('a', bucket);
    expect((await store.consume('a', window)).allowed).toBe(true);
  });

  it('uses the injected clock', async () => {
    const clock = new FakeClock();
    const store = new MemoryStore(clock);
    await store.consume('a', bucket);
    await store.consume('a', bucket);
    expect((await store.consume('a', bucket)).allowed).toBe(false);
    clock.advance(1000);
    expect((await store.consume('a', bucket)).allowed).toBe(true);
  });

  it('allows exactly `limit` out of many concurrent calls', async () => {
    const store = new MemoryStore(new FakeClock());
    const rule: Rule = { algorithm: 'token-bucket', capacity: 50, refillPerSecond: 1 };
    const results = await Promise.all(Array.from({ length: 200 }, () => store.consume('k', rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(50);
  });

  it.each<[string, Rule]>([
    ['zero capacity', { algorithm: 'token-bucket', capacity: 0, refillPerSecond: 1 }],
    ['fractional capacity', { algorithm: 'token-bucket', capacity: 1.5, refillPerSecond: 1 }],
    ['zero refill', { algorithm: 'token-bucket', capacity: 1, refillPerSecond: 0 }],
    ['NaN refill', { algorithm: 'token-bucket', capacity: 1, refillPerSecond: Number.NaN }],
    ['zero limit', { algorithm: 'sliding-window', limit: 0, windowMs: 1000 }],
    ['negative window', { algorithm: 'sliding-window', limit: 1, windowMs: -1 }],
  ])('rejects invalid rules: %s', async (_, rule) => {
    await expect(new MemoryStore().consume('k', rule)).rejects.toThrow(RangeError);
  });
});
