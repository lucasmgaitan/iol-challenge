import { describe, expect, it } from 'vitest';
import { slidingWindow, type SlidingWindowState } from '#algorithms/sliding-window.js';
import { Algorithm, type Decision, type SlidingWindowRule } from '#core/types.js';

const rule: SlidingWindowRule = { algorithm: Algorithm.SlidingWindow, limit: 4, windowMs: 1000 };

function run(times: number[], r: SlidingWindowRule = rule): Decision[] {
  let state: SlidingWindowState | undefined;
  return times.map((t) => {
    const out = slidingWindow(state, r, t);
    state = out.state;
    return out.decision;
  });
}

describe('slidingWindow', () => {
  it('allows up to the limit within one window', () => {
    const d = run([0, 100, 200, 300, 400]);
    expect(d.map((x) => x.allowed)).toEqual([true, true, true, true, false]);
    expect(d.map((x) => x.remaining)).toEqual([3, 2, 1, 0, 0]);
  });

  it('weights the previous window by its remaining overlap', () => {
    const d = run([0, 0, 0, 0, 1250, 1250]);
    expect(d[4]?.allowed).toBe(true);
    expect(d[5]?.allowed).toBe(false);
  });

  it('prevents the fixed-window double burst at the boundary', () => {
    const d = run([999, 999, 999, 999, 1000, 1000]);
    expect(d.slice(4).map((x) => x.allowed)).toEqual([false, false]);
  });

  it('computes retry-after within the current window', () => {
    const d = run([0, 0, 0, 0, 1000]);
    expect(d[4]).toMatchObject({ allowed: false, retryAfterMs: 250 });
  });

  it('computes retry-after spanning into the next window', () => {
    const d = run([0, 0, 0, 0, 500]);
    expect(d[4]).toMatchObject({ allowed: false, retryAfterMs: 750 });
  });

  it('forgets everything after two idle windows', () => {
    const d = run([0, 0, 0, 0, 2000, 2000, 2000, 2000]);
    expect(d.slice(4).map((x) => x.allowed)).toEqual([true, true, true, true]);
  });

  it('does not count rejected requests', () => {
    const d = run([0, 0, 0, 0, 0, 0, 0, 1500]);
    expect(d[7]?.allowed).toBe(true);
  });

  it('keeps the newest state when the clock goes backwards', () => {
    const d = run([5000, 5000, 5000, 5000, 3000]);
    expect(d[4]?.allowed).toBe(false);
  });
});
