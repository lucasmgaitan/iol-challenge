import { describe, expect, it } from 'vitest';
import { CLOCK_BACKWARDS_ERROR, FakeClock, systemClock } from '../../src/core/clock.js';

describe('FakeClock', () => {
  it('starts at the given time and advances manually', () => {
    const clock = new FakeClock(1_000);
    expect(clock.now()).toBe(1_000);
    clock.advance(250);
    expect(clock.now()).toBe(1_250);
  });

  it('rejects moving backwards', () => {
    expect(() => {
      new FakeClock().advance(-1);
    }).toThrow(CLOCK_BACKWARDS_ERROR);
  });
});

describe('systemClock', () => {
  it('returns wall-clock time', () => {
    const before = Date.now();
    expect(systemClock.now()).toBeGreaterThanOrEqual(before);
  });
});
