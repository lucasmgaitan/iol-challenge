import { describe, expect, it } from 'vitest';
import { Algorithm, type SlidingWindowRule, type SlidingWindowState } from '#core/types.js';
import { slidingWindow } from '#strategies/sliding-window.js';

const rule: SlidingWindowRule = {
  name: 'test',
  algorithm: Algorithm.SlidingWindow,
  limit: 4,
  windowMs: 1000,
};
const WINDOW_START_MS = 1_000_000;

describe('sliding window counter', () => {
  it('allows up to the limit within one window, then rejects', () => {
    let stored: SlidingWindowState | undefined;
    const decisions = [];
    for (let request = 0; request < 5; request++) {
      const { decision, state } = slidingWindow.decide(rule, stored, WINDOW_START_MS);
      decisions.push(decision);
      stored = state ?? stored;
    }
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([3, 2, 1, 0, 0]);
    expect(stored).toEqual({ windowStart: WINDOW_START_MS, current: 4, previous: 0 });
  });

  it('weights the previous window by how much of it still overlaps', () => {
    const stored: SlidingWindowState = { windowStart: WINDOW_START_MS, current: 4, previous: 0 };
    const tenthIntoNext = WINDOW_START_MS + 1100;
    expect(slidingWindow.decide(rule, stored, tenthIntoNext).decision.allowed).toBe(false);
    const halfIntoNext = WINDOW_START_MS + 1500;
    const { decision, state } = slidingWindow.decide(rule, stored, halfIntoNext);
    expect(decision).toMatchObject({ allowed: true, remaining: 1 });
    expect(state).toEqual({ windowStart: WINDOW_START_MS + 1000, current: 1, previous: 4 });
  });

  it('tells how long until the previous window weighs little enough', () => {
    const stored: SlidingWindowState = { windowStart: WINDOW_START_MS, current: 4, previous: 0 };
    const { decision } = slidingWindow.decide(rule, stored, WINDOW_START_MS + 1100);
    expect(decision.retryAfterMs).toBe(150);
  });

  it('tells how long until the current window weighs little enough when it is full', () => {
    const stored: SlidingWindowState = { windowStart: WINDOW_START_MS, current: 4, previous: 4 };
    const { decision } = slidingWindow.decide(rule, stored, WINDOW_START_MS + 200);
    expect(decision.retryAfterMs).toBe(1050);
  });

  it('forgets windows older than the previous one', () => {
    const stored: SlidingWindowState = { windowStart: WINDOW_START_MS, current: 4, previous: 4 };
    expect(slidingWindow.decide(rule, stored, WINDOW_START_MS + 2000).state).toEqual({
      windowStart: WINDOW_START_MS + 2000,
      current: 1,
      previous: 0,
    });
  });

  it('does not persist anything when it rejects', () => {
    const stored: SlidingWindowState = { windowStart: WINDOW_START_MS, current: 4, previous: 0 };
    expect(slidingWindow.decide(rule, stored, WINDOW_START_MS).state).toBeUndefined();
  });
});
