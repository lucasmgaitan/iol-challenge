import { describe, expect, it } from 'vitest';
import { MemoryStore } from '#stores/memory-store.js';

const increment = (prev: number | undefined) => {
  const next = (prev ?? 0) + 1;
  return { state: next, result: next };
};

describe('MemoryStore', () => {
  it('passes undefined for a key that was never written', () => {
    const store = new MemoryStore();
    let seen: number | undefined = -1;
    store.update('k', (prev: number | undefined) => {
      seen = prev;
      return { state: 0, result: null };
    });
    expect(seen).toBeUndefined();
  });

  it('persists the state returned by the transition and returns its result', () => {
    const store = new MemoryStore();
    expect(store.update('k', increment)).toBe(1);
    expect(store.update('k', increment)).toBe(2);
  });

  it('keeps keys independent', () => {
    const store = new MemoryStore();
    store.update('a', increment);
    expect(store.update('b', increment)).toBe(1);
  });

  it('does not persist anything when the transition throws', () => {
    const store = new MemoryStore();
    store.update('k', increment);
    expect(() =>
      store.update('k', () => {
        throw new Error();
      }),
    ).toThrow();
    expect(store.update('k', increment)).toBe(2);
  });
});
